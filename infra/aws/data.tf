resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier                  = "${local.name_prefix}-pg16"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "ftth_copilot"
  username                    = "ftth"
  password                    = random_password.db_password.result
  db_subnet_group_name        = aws_db_subnet_group.postgres.name
  vpc_security_group_ids      = [aws_security_group.rds.id]
  publicly_accessible         = false
  backup_retention_period     = 7
  skip_final_snapshot         = var.deploy_env != "prod"
  deletion_protection         = var.deploy_env == "prod"
  allow_major_version_upgrade = false
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name_prefix}-redis-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  count                        = var.enable_emulated_unsupported_resources ? 1 : 0
  replication_group_id         = "${local.name_prefix}-redis"
  description                  = "BullMQ and rate-limit Redis with TLS and auth token"
  engine                       = "redis"
  engine_version               = "7.1"
  node_type                    = var.redis_node_type
  num_cache_clusters           = 1
  port                         = 6379
  subnet_group_name            = aws_elasticache_subnet_group.redis.name
  security_group_ids           = [aws_security_group.redis.id]
  transit_encryption_enabled   = true
  at_rest_encryption_enabled   = true
  auth_token                   = random_password.redis_auth_token.result
  automatic_failover_enabled   = false
}
