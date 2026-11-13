variable "project_name" {
  description = "Short project prefix for AWS resources."
  type        = string
  default     = "ftth-copilot"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "deploy_env" {
  description = "Deployment environment (staging, demo, or prod)."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "demo", "prod"], var.deploy_env)
    error_message = "deploy_env must be one of: staging, demo, prod."
  }
}

variable "aws_region" {
  description = "AWS region for the reference deployment."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "IPv4 CIDR block for the VPC."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "enable_nat_gateway" {
  description = "Provision a NAT Gateway for private subnets. Disable to rely solely on VPC endpoints."
  type        = bool
  default     = true
}

variable "allowed_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the public ALB (HTTP/HTTPS)."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "allowed_udp_cidrs" {
  description = "CIDR blocks allowed to send SNMP (1162) and syslog (5514) UDP traffic to the worker NLB (e.g. ISP VPN CIDR)."
  type        = list(string)
  default     = ["10.40.0.0/16"]
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on the ALB. When null, ALB serves HTTP only (for staging/emulator)."
  type        = string
  default     = null
}

variable "web_desired_count" {
  description = "Initial desired task count for the web ECS service."
  type        = number
  default     = 1
}

variable "web_min_capacity" {
  description = "Minimum ECS task count for web autoscaling."
  type        = number
  default     = 1
}

variable "web_max_capacity" {
  description = "Maximum ECS task count for web autoscaling."
  type        = number
  default     = 4
}

variable "worker_desired_count" {
  description = "Desired task count for the worker ECS service (BullMQ job schedulers deduplicate across replicas)."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS PostgreSQL 16 instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GiB for RDS PostgreSQL."
  type        = number
  default     = 20

  validation {
    condition     = var.db_allocated_storage >= 20
    error_message = "db_allocated_storage must be at least 20 GiB."
  }
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "allowed_account_ids" {
  description = "Optional list of allowed AWS account IDs (e.g. [\"000000000000\"] for AWS Emulator)."
  type        = list(string)
  default     = null
}

variable "emulator_mode" {
  description = "Enable AWS Emulator compatibility flags (skip metadata/credential checks)."
  type        = bool
  default     = false
}

variable "s3_use_path_style" {
  description = "Use path-style S3 addressing (required by local emulators)."
  type        = bool
  default     = false
}

variable "enable_emulated_unsupported_resources" {
  description = "Set to false in AWS Emulator runs to exclude resources whose APIs return 501 NotImplemented."
  type        = bool
  default     = true
}
