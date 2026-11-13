resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name_prefix}/web"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name_prefix}/worker"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "migrations" {
  name              = "/ecs/${local.name_prefix}/migrations"
  retention_in_days = 30
}

# ── IAM Roles ────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name_prefix}-ecs-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name_prefix}-read-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.db_credentials.arn,
        aws_secretsmanager_secret.app_runtime.arn,
      ]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_backups" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.backups_writer.arn
}

# ── Web Application Load Balancer ────────────────────────────────────────────

resource "aws_lb" "web" {
  name                       = "${local.name_prefix}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name_prefix}-web-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "web_http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.acm_certificate_arn != null ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = var.acm_certificate_arn == null ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }
}

resource "aws_lb_listener" "web_https" {
  count             = var.acm_certificate_arn != null ? 1 : 0
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# ── ECS Cluster & Task Definitions ───────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  count = var.enable_emulated_unsupported_resources ? 1 : 0
  name  = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "migrations" {
  count                    = var.enable_emulated_unsupported_resources ? 1 : 0
  family                   = "${local.name_prefix}-migrations"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "migrations"
    image     = "${aws_ecr_repository.web.repository_url}:latest"
    essential = true
    command   = ["pnpm", "db:deploy"]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DEPLOY_ENV", value = var.deploy_env },
    ]
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:database_url::"
      },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrations.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migrations"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  count                    = var.enable_emulated_unsupported_resources ? 1 : 0
  family                   = "${local.name_prefix}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = "${aws_ecr_repository.web.repository_url}:latest"
    essential = true
    portMappings = [{
      containerPort = 3001
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "DEPLOY_ENV", value = var.deploy_env },
      { name = "JOBS_BACKEND", value = "worker" },
      { name = "SESSION_COOKIE_SECURE", value = var.acm_certificate_arn != null ? "true" : "false" },
    ]
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:database_url::"
      },
      {
        name      = "REDIS_URL"
        valueFrom = "${aws_secretsmanager_secret.app_runtime.arn}:redis_url::"
      },
      {
        name      = "JWT_SECRET"
        valueFrom = "${aws_secretsmanager_secret.app_runtime.arn}:jwt_secret::"
      },
      {
        name      = "KMS_MASTER_KEY"
        valueFrom = "${aws_secretsmanager_secret.app_runtime.arn}:kms_master_key::"
      },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  count           = var.enable_emulated_unsupported_resources ? 1 : 0
  name            = "${local.name_prefix}-web"
  cluster         = aws_ecs_cluster.main[0].id
  task_definition = aws_ecs_task_definition.web[0].arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.web_http]
}

resource "aws_appautoscaling_target" "web" {
  count              = var.enable_emulated_unsupported_resources ? 1 : 0
  max_capacity       = var.web_max_capacity
  min_capacity       = var.web_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main[0].name}/${aws_ecs_service.web[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "web_cpu" {
  count              = var.enable_emulated_unsupported_resources ? 1 : 0
  name               = "${local.name_prefix}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web[0].resource_id
  scalable_dimension = aws_appautoscaling_target.web[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.web[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
  }
}

# ── Worker ECS Service & UDP NLB ─────────────────────────────────────────────

resource "aws_lb" "worker_udp" {
  count              = var.enable_emulated_unsupported_resources ? 1 : 0
  name               = "${local.name_prefix}-worker-nlb"
  internal           = true
  load_balancer_type = "network"
  subnets            = aws_subnet.private[*].id
}

resource "aws_lb_target_group" "worker_snmp" {
  count       = var.enable_emulated_unsupported_resources ? 1 : 0
  name        = "${local.name_prefix}-snmp-tg"
  port        = 1162
  protocol    = "UDP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    protocol = "TCP"
    port     = "8081"
  }
}

resource "aws_lb_target_group" "worker_syslog" {
  count       = var.enable_emulated_unsupported_resources ? 1 : 0
  name        = "${local.name_prefix}-syslog-tg"
  port        = 5514
  protocol    = "UDP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    protocol = "TCP"
    port     = "8081"
  }
}

resource "aws_lb_listener" "worker_snmp" {
  count             = var.enable_emulated_unsupported_resources ? 1 : 0
  load_balancer_arn = aws_lb.worker_udp[0].arn
  port              = 1162
  protocol          = "UDP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.worker_snmp[0].arn
  }
}

resource "aws_lb_listener" "worker_syslog" {
  count             = var.enable_emulated_unsupported_resources ? 1 : 0
  load_balancer_arn = aws_lb.worker_udp[0].arn
  port              = 5514
  protocol          = "UDP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.worker_syslog[0].arn
  }
}

resource "aws_ecs_task_definition" "worker" {
  count                    = var.enable_emulated_unsupported_resources ? 1 : 0
  family                   = "${local.name_prefix}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "worker"
    image     = "${aws_ecr_repository.worker.repository_url}:latest"
    essential = true
    portMappings = [
      { containerPort = 8081, protocol = "tcp" },
      { containerPort = 1162, protocol = "udp" },
      { containerPort = 5514, protocol = "udp" },
    ]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DEPLOY_ENV", value = var.deploy_env },
      { name = "WORKER_HOST", value = "0.0.0.0" },
      { name = "WORKER_PORT", value = "8081" },
    ]
    secrets = [
      {
        name      = "DATABASE_URL"
        valueFrom = "${aws_secretsmanager_secret.db_credentials.arn}:database_url::"
      },
      {
        name      = "REDIS_URL"
        valueFrom = "${aws_secretsmanager_secret.app_runtime.arn}:redis_url::"
      },
      {
        name      = "KMS_MASTER_KEY"
        valueFrom = "${aws_secretsmanager_secret.app_runtime.arn}:kms_master_key::"
      },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  count           = var.enable_emulated_unsupported_resources ? 1 : 0
  name            = "${local.name_prefix}-worker"
  cluster         = aws_ecs_cluster.main[0].id
  task_definition = aws_ecs_task_definition.worker[0].arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.worker_snmp[0].arn
    container_name   = "worker"
    container_port   = 1162
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.worker_syslog[0].arn
    container_name   = "worker"
    container_port   = 5514
  }
}
