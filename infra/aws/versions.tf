terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state with native S3 lockfile (Terraform >= 1.10).
  # Pass bucket/region/key via -backend-config or use -backend=false for local/emulator runs.
  # backend "s3" {
  #   bucket       = "ftth-copilot-tfstate"
  #   key          = "staging/terraform.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}
