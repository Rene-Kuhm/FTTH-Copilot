provider "aws" {
  region                      = var.aws_region
  allowed_account_ids         = var.allowed_account_ids
  s3_use_path_style           = var.s3_use_path_style
  skip_credentials_validation = var.emulator_mode
  skip_metadata_api_check     = var.emulator_mode

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.deploy_env
      ManagedBy   = "terraform"
    }
  }
}
