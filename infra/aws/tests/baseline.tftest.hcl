mock_provider "aws" {
  override_during = plan

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/test"
    }
  }

  mock_resource "aws_iam_policy" {
    defaults = {
      arn = "arn:aws:iam::123456789012:policy/test"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test/abc123"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/test/abc123"
    }
  }

  mock_resource "aws_ecr_repository" {
    defaults = {
      repository_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com/ftth-copilot"
    }
  }

  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:ftth-copilot/test-AbCdEf"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      address  = "ftth-copilot-test.abcdef123456.us-east-1.rds.amazonaws.com"
      endpoint = "ftth-copilot-test.abcdef123456.us-east-1.rds.amazonaws.com:5432"
    }
  }

  mock_resource "aws_elasticache_replication_group" {
    defaults = {
      primary_endpoint_address = "master.ftth-copilot-test.use1.cache.amazonaws.com"
    }
  }
}

mock_provider "random" {
  override_during = plan

  mock_resource "random_password" {
    defaults = {
      result = "test-auth-token-0123"
    }
  }
}

override_data {
  target = data.aws_availability_zones.available
  values = {
    names = ["us-east-1a", "us-east-1b"]
  }
}

override_data {
  target = data.aws_iam_policy_document.ecs_assume_role
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"
  }
}

variables {
  deploy_env = "staging"
  aws_region = "us-east-1"
}

run "rds_private_and_encrypted" {
  command = plan

  assert {
    condition     = aws_db_instance.postgres.publicly_accessible == false
    error_message = "RDS PostgreSQL must never be publicly accessible."
  }

  assert {
    condition     = aws_db_instance.postgres.storage_encrypted == true
    error_message = "RDS PostgreSQL storage must be encrypted."
  }
}

run "elasticache_tls_and_auth" {
  command = plan

  assert {
    condition     = aws_elasticache_replication_group.redis[0].transit_encryption_enabled == true
    error_message = "ElastiCache Redis must enforce TLS in transit."
  }

  assert {
    condition     = tobool(aws_elasticache_replication_group.redis[0].at_rest_encryption_enabled) == true
    error_message = "ElastiCache Redis must enforce encryption at rest."
  }

  assert {
    condition     = aws_elasticache_replication_group.redis[0].auth_token != null
    error_message = "ElastiCache Redis must require an auth_token."
  }
}

run "security_groups_least_privilege" {
  command = plan

  assert {
    condition     = !contains(flatten([for r in aws_security_group.rds.ingress : r.cidr_blocks]), "0.0.0.0/0")
    error_message = "RDS security group must not open 0.0.0.0/0."
  }

  assert {
    condition     = !contains(flatten([for r in aws_security_group.redis.ingress : r.cidr_blocks]), "0.0.0.0/0")
    error_message = "Redis security group must not open 0.0.0.0/0."
  }

  assert {
    condition     = !contains(flatten([for r in aws_security_group.worker.ingress : r.cidr_blocks]), "0.0.0.0/0")
    error_message = "Worker security group must not open 0.0.0.0/0."
  }

  assert {
    condition = alltrue([
      for r in aws_security_group.alb.ingress :
      contains([80, 443], r.from_port) && contains([80, 443], r.to_port)
    ])
    error_message = "ALB security group may only expose ports 80 and 443."
  }
}

run "secrets_from_secrets_manager_and_migrations_db_deploy" {
  command = plan

  assert {
    condition = length([
      for e in jsondecode(aws_ecs_task_definition.web[0].container_definitions)[0].environment :
      e.name if contains(["JWT_SECRET", "KMS_MASTER_KEY", "DATABASE_URL", "REDIS_URL"], e.name)
    ]) == 0
    error_message = "Web ECS task must not pass secrets in plaintext environment."
  }

  assert {
    condition = length([
      for s in jsondecode(aws_ecs_task_definition.web[0].container_definitions)[0].secrets :
      s.name
    ]) == 4
    error_message = "Web ECS task must inject DATABASE_URL, REDIS_URL, JWT_SECRET, and KMS_MASTER_KEY via Secrets Manager."
  }

  assert {
    condition     = join(" ", jsondecode(aws_ecs_task_definition.migrations[0].container_definitions)[0].command) == "pnpm db:deploy"
    error_message = "Migrations ECS task must run pnpm db:deploy (never db push)."
  }
}

run "backup_bucket_hardened" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.backups.versioning_configuration[0].status == "Enabled"
    error_message = "Backup S3 bucket must have versioning enabled."
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.backups.block_public_acls == true &&
      aws_s3_bucket_public_access_block.backups.block_public_policy == true &&
      aws_s3_bucket_public_access_block.backups.ignore_public_acls == true &&
      aws_s3_bucket_public_access_block.backups.restrict_public_buckets == true
    )
    error_message = "Backup S3 bucket must block all public access."
  }
}

run "invalid_deploy_env_fails" {
  command = plan

  variables {
    deploy_env = "invalid-env"
  }

  expect_failures = [
    var.deploy_env,
  ]
}

run "invalid_vpc_cidr_fails" {
  command = plan

  variables {
    vpc_cidr = "not-a-cidr"
  }

  expect_failures = [
    var.vpc_cidr,
  ]
}
