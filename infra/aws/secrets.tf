resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "random_password" "redis_auth_token" {
  length  = 40
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "kms_master_key" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "${local.name_prefix}/db-credentials"
  recovery_window_in_days = var.deploy_env == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username     = "ftth"
    password     = random_password.db_password.result
    database_url = "postgresql://ftth:${random_password.db_password.result}@${aws_db_instance.postgres.endpoint}/ftth_copilot?sslmode=require"
  })
}

resource "aws_secretsmanager_secret" "app_runtime" {
  name                    = "${local.name_prefix}/app-runtime"
  recovery_window_in_days = var.deploy_env == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "app_runtime" {
  secret_id = aws_secretsmanager_secret.app_runtime.id
  secret_string = jsonencode({
    jwt_secret     = random_password.jwt_secret.result
    kms_master_key = random_password.kms_master_key.result
    redis_url      = var.enable_emulated_unsupported_resources ? "rediss://:${random_password.redis_auth_token.result}@${aws_elasticache_replication_group.redis[0].primary_endpoint_address}:6379" : "rediss://:${random_password.redis_auth_token.result}@localhost:6379"
  })
}
