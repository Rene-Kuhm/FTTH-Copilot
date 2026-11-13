# Cómo desplegar FTTH-Copilot en AWS (Terraform)

Esta guía describe el despliegue de referencia en **AWS** usando Terraform (`infra/aws/`), pensado para entornos reproducibles de **staging / demo** (`DEPLOY_ENV=staging`) con datos sintéticos que pueden levantarse y destruirse por completo. No modifica la arquitectura del producto: es una opción de despliegue adicional junto a Docker Compose.

> **Advertencia de costos:** ejecutar `terraform apply` contra una cuenta real de AWS crea recursos facturables (RDS, ElastiCache, NAT Gateway, ALB/NLB, ECS Fargate). No corras `apply` sin presupuesto aprobado y ejecutá `terraform destroy` al terminar la demo.

---

## 1. Arquitectura de referencia en AWS

El stack en [`infra/aws/`](../../infra/aws/) aprovisiona:

- **Red (`network.tf`):** VPC en 2 zonas de disponibilidad (`10.40.0.0/16` por defecto), subredes públicas y privadas, Internet Gateway y **1 NAT Gateway opcional** (`enable_nat_gateway = true`).
- **Imágenes (`ecr.tf`):** repositorios ECR inmutables para `web` y `worker`, con política de retención de las últimas 10 imágenes.
- **Cómputo (`ecs.tf`):**
  - Cluster ECS Fargate con CloudWatch Container Insights habilitado.
  - Servicio **`web`** detrás de un **ALB** (HTTP→HTTPS redirect automático cuando `acm_certificate_arn` está definido) y autoescalado por CPU.
  - Servicio **`worker`** detrás de un **NLB UDP** (`1162/udp` para traps SNMP y `5514/udp` para syslog) con health check TCP en el puerto `:8081`.
  - Definición de tarea **`migrations`** independiente que ejecuta `pnpm db:deploy` (nunca `db push`) antes de actualizar `web` y `worker`.
- **Datos (`data.tf`):**
  - **RDS PostgreSQL 16** en subred privada, cifrado en reposo, backups automáticos (7 días) y sin acceso público.
  - **ElastiCache Redis 7** en subred privada, con cifrado en tránsito (`rediss://`), cifrado en reposo y `auth_token` rotado por Secrets Manager.
- **Secretos (`secrets.tf`):** AWS Secrets Manager para credenciales de base de datos, `JWT_SECRET`, `KMS_MASTER_KEY`, `REDIS_AUTH_TOKEN` y `REDIS_URL`. Ningún secreto vive en el código ni en variables en texto plano.
- **Backups (`storage.tf`):** bucket S3 versionado, cifrado con SSE-S3/AES256, bloqueo total de acceso público y política IAM de mínimo privilegio (`backups_writer`) para `scripts/db-backup.sh`.

### Decisión de red: NAT Gateway único vs. VPC Endpoints

Para un entorno `staging` efímero se eligió **1 NAT Gateway compartido** (`enable_nat_gateway = true`) en lugar de múltiples VPC Interface Endpoints (ECR API, ECR DKR, Secrets Manager, CloudWatch Logs, S3). Un conjunto completo de Interface Endpoints cuesta más por hora base que un único NAT Gateway en una demo corta, además de simplificar el enrutamiento hacia `scripts/db-backup.sh` o integraciones externas. Para producción multi-AZ de alta disponibilidad se recomienda habilitar un NAT Gateway por AZ o evaluar VPC Endpoints según el volumen de tráfico ECR/CloudWatch.

---

## 2. Prerrequisitos

- **Terraform** `>= 1.11.0`
- **AWS CLI v2** autenticado contra la cuenta objetivo
- **Docker** (para construir y subir las imágenes `web` y `worker` a ECR)
- *(Opcional)* **Certificado ACM** en la misma región si querés exponer el ALB por HTTPS con dominio propio
- *(Opcional)* **Infracost** para estimar costos antes de aplicar

---

## 3. Variables principales

| Variable | Default | Descripción |
|---|---|---|
| `aws_region` | `us-east-1` | Región AWS donde se crea el stack. |
| `deploy_env` | `staging` | Entorno (`staging` o `production`). |
| `vpc_cidr` | `10.40.0.0/16` | Bloque CIDR de la VPC. |
| `enable_nat_gateway` | `true` | Crea 1 NAT Gateway para salida a internet desde subredes privadas. |
| `acm_certificate_arn` | `null` | ARN de certificado ACM; si se define, el ALB habilita listener HTTPS `:443` y redirige `:80 -> :443`. |
| `allowed_udp_cidrs` | `["198.51.100.0/24"]` | CIDRs autorizados a enviar traps SNMP (`1162/udp`) y syslog (`5514/udp`) al NLB. |
| `db_allocated_storage` | `20` | Almacenamiento inicial de RDS en GiB (`>= 20`). |
| `allowed_account_ids` | `[]` | Lista opcional de IDs de cuenta AWS permitidos por el provider. |

### Estado remoto de Terraform

[`infra/aws/versions.tf`](../../infra/aws/versions.tf) incluye comentado el bloque `backend "s3"` con **`use_lockfile = true`** (locking nativo sobre S3 introducido en Terraform 1.10+, sin necesidad de tabla DynamoDB). Para usarlo en un despliegue real, descomentá el bloque y pasá tu bucket en `-backend-config`.

---

## 4. Pasos de despliegue

1. **Inicializar y validar el plan:**

   ```bash
   cd infra/aws
   terraform init
   terraform plan -var="allowed_udp_cidrs=[\"198.51.100.0/24\"]" -out=tfplan
   ```

2. **Aplicar la infraestructura base** (con aprobación explícita):

   ```bash
   terraform apply tfplan
   ```

3. **Construir y subir las imágenes a ECR:**

   ```bash
   WEB_REPO=$(terraform output -raw ecr_web_repository_url)
   WORKER_REPO=$(terraform output -raw ecr_worker_repository_url)
   AWS_REGION=$(terraform output -raw aws_region || echo "us-east-1")

   aws ecr get-login-password --region "$AWS_REGION" | \
     docker login --username AWS --password-stdin "${WEB_REPO%/*}"

   docker build -f Dockerfile -t "$WEB_REPO:v0.7.1" .
   docker push "$WEB_REPO:v0.7.1"

   docker build -f services/worker/Dockerfile -t "$WORKER_REPO:v0.7.1" .
   docker push "$WORKER_REPO:v0.7.1"
   ```

4. **Correr las migraciones (`pnpm db:deploy`) antes de levantar el tráfico:**

   ```bash
   CLUSTER=$(terraform output -raw ecs_cluster_name)
   MIGRATIONS_TD=$(terraform output -raw migrations_task_definition_arn)
   PRIVATE_SUBNETS=$(terraform output -json private_subnet_ids | jq -r 'join(",")')
   ECS_SG=$(terraform output -raw ecs_tasks_security_group_id)

   aws ecs run-task \
     --cluster "$CLUSTER" \
     --launch-type FARGATE \
     --task-definition "$MIGRATIONS_TD" \
     --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}"
   ```

5. **Actualizar los servicios `web` y `worker`** con el tag `:v0.7.1` y verificar que las tareas queden `RUNNING`.

---

## 5. Verificación y particularidades técnicas

### Redis TLS (`rediss://`) con ElastiCache y BullMQ

ElastiCache se aprovisiona con `transit_encryption_enabled = true` y `auth_token`. En [`packages/jobs/src/connection.ts`](../../packages/jobs/src/connection.ts), `parseRedisUrl()` convierte la URL `rediss://:token@host:6379` en opciones explícitas de `ioredis` (`host`, `port`, `password`, `tls: {}`) manteniendo `maxRetriesPerRequest: null` para BullMQ workers. Sin esa conversión, pasar `{ url }` directo a `ioredis` ignora el campo y falla contra endpoints TLS.

### Receptores UDP del worker (`1162/udp` SNMP y `5514/udp` syslog)

- El NLB escucha en `1162/udp` y `5514/udp` y verifica la salud del worker mediante TCP contra el puerto `:8081`.
- **Preservación de IP de origen:** con target groups de tipo `ip` (requeridos por ECS Fargate `awsvpc`), AWS NLB realiza SNAT de la IP del cliente en tráfico UDP hacia targets `ip` a menos que se utilice Proxy Protocol v2 (que SNMP/syslog estándar no soportan) o instancias EC2 con target type `instance`. Por eso, en Fargate se debe validar el comportamiento de origen con:

  ```bash
  pnpm verify:syslog-source-ip
  ```

- **Tráfico real de OLTs vs. demo:** en producción, las OLTs viven en la red privada del ISP y requieren una **VPN site-to-site** o **AWS Direct Connect** hacia la VPC (nunca exponer `0.0.0.0/0` al NLB UDP). Para la demo en staging se usa tráfico sintético (`pnpm test:syslog` y `pnpm test:snmp`) restringido a `allowed_udp_cidrs`.

### Observabilidad (VictoriaMetrics)

VictoriaMetrics queda **fuera de esta primera iteración** para mantener el stack de demo liviano. Para agregarlo más adelante en AWS existen dos caminos recomendados:

1. **Servicio ECS con EFS:** ejecutar un contenedor `victoriametrics/victoria-metrics` montando un volumen Amazon EFS para retención de series temporales sin administrar EC2.
2. **Amazon Managed Service for Prometheus (AMP):** reemplazar el endpoint de remote-write por un workspace administrado de AMP usando `aws-sigv4` en el collector.

---

## 6. Estimación de costos

Podés estimar el costo mensual antes de aplicar usando Infracost:

```bash
infracost breakdown --path infra/aws
```

---

## 7. Validación automatizada (Capas 1–4 en CI)

El workflow [`.github/workflows/terraform.yml`](../../.github/workflows/terraform.yml) ejecuta cuatro capas de verificación:

1. **Capa 1 (Estática):** `terraform fmt -check -recursive`, `terraform validate`, `tflint` y `trivy config`.
2. **Capa 2 (Unitaria con mocks):** `terraform test` sobre [`infra/aws/tests/baseline.tftest.hcl`](../../infra/aws/tests/baseline.tftest.hcl) usando `mock_provider "aws"` y `mock_provider "random"`.
3. **Capa 3 (AWS Emulator):** levanta el emulador local (`EMULATOR_TELEMETRY=off`) con `emulator_mode = true` y ejecuta `terraform apply`, verificación de idempotencia (`terraform plan -detailed-exitcode`) y `terraform destroy`.
4. **Capa 4 (Backup / Restore):** prueba [`scripts/db-backup.sh`](../../scripts/db-backup.sh) y [`scripts/db-restore.sh`](../../scripts/db-restore.sh) contra PostgreSQL 16 y el bucket S3 emulado.

**Fidelidad del emulador:** el emulador verifica sintaxis del grafo, S3, IAM, Secrets Manager, ciclo apply/idempotencia/destroy y el flujo real de backup/restore. No reemplaza la validación en AWS real de certificados ACM, preservación de IP UDP en NLB sobre Fargate ni políticas de autoescalado bajo carga.

---

## 8. Rollback y cómo apagarlo

### Rollback de aplicación

Si una nueva versión falla tras `migrations`:

1. Revertí la task definition de `web` y `worker` a la revisión anterior estable en ECS (`aws ecs update-service --task-definition ...`).
2. Si una migración SQL requiere restauración completa, descargá el último snapshot desde el bucket S3 de backups y ejecutá [`scripts/db-restore.sh`](../../scripts/db-restore.sh).

### Cómo apagarlo (`terraform destroy`)

Para destruir todo el entorno de staging y cortar la facturación:

```bash
cd infra/aws
terraform destroy
```

Si los repositorios ECR tienen imágenes subidas y bloquean la eliminación, vacialos primero o habilitá `force_delete = true` temporalmente antes de volver a correr `terraform destroy`.
