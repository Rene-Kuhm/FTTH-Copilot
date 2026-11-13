output "vpc_id" {
  description = "ID of the FTTH-Copilot VPC."
  value       = aws_vpc.main.id
}

output "alb_dns_name" {
  description = "DNS name of the web Application Load Balancer."
  value       = aws_lb.web.dns_name
}

output "worker_nlb_dns_name" {
  description = "DNS name of the worker Network Load Balancer (UDP 1162/5514)."
  value       = var.enable_emulated_unsupported_resources ? aws_lb.worker_udp[0].dns_name : null
}

output "ecr_web_repository_url" {
  description = "ECR repository URL for the web image."
  value       = aws_ecr_repository.web.repository_url
}

output "ecr_worker_repository_url" {
  description = "ECR repository URL for the worker image."
  value       = aws_ecr_repository.worker.repository_url
}

output "backups_bucket_name" {
  description = "S3 bucket name for PostgreSQL backups."
  value       = aws_s3_bucket.backups.id
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = var.enable_emulated_unsupported_resources ? aws_ecs_cluster.main[0].name : null
}

output "migrations_task_definition_arn" {
  description = "ECS task definition ARN for running pnpm db:deploy."
  value       = var.enable_emulated_unsupported_resources ? aws_ecs_task_definition.migrations[0].arn : null
}
