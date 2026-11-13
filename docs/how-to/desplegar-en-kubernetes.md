# Cómo desplegar FTTH-Copilot en Kubernetes (Helm)

Esta guía explica cómo desplegar **FTTH-Copilot** en un clúster Kubernetes usando el chart de Helm en [`infra/helm/ftth-copilot/`](../../infra/helm/ftth-copilot/). No cambia la arquitectura de la aplicación: separa el frontend/API stateless (`web`), el procesador de colas y receptores UDP (`worker`) y un Job de migraciones (`pnpm db:deploy`).

---

## 1. Qué despliega el chart

- **`web` (`Deployment` + `Service` + `Ingress` / `HPA` / `PDB` opcionales):** sirve Next.js en el puerto `3001` con probes HTTP contra `/api/health?scope=container`. Corre como usuario no-root (`uid 1001`) con `RuntimeDefault` seccomp y todas las Linux capabilities eliminadas.
- **`worker` (`Deployment` + `Service` + `PVC` opcional):** ejecuta BullMQ, cron schedulers y los receptores UDP (`1162/udp` para traps SNMP y `5514/udp` para syslog), con probe HTTP contra `:8081/healthz` y spool configurable en `/var/lib/ftth-copilot/spool`.
- **`migrations` (`Job` con hook `pre-install,pre-upgrade`):** ejecuta `pnpm db:deploy` antes de instalar o actualizar `web` y `worker`.
- **`postgresql` y `redis` (opcionales, habilitados por defecto solo para dev/staging):** despliegues rápidos dentro del clúster. En producción deben deshabilitarse para usar bases administradas y un `Secret` externo.
- **`NetworkPolicy` (opcional):** restringe el tráfico entrante a `web` (`3001/tcp`) y `worker` (`1162/udp`, `5514/udp`, `8081/tcp`).

---

## 2. Prerrequisitos

- Clúster Kubernetes (`>= 1.28`) y `kubectl` configurado
- **Helm** `>= 3.17`
- Imágenes `web` y `worker` accesibles desde el clúster (por ejemplo en GHCR o ECR)

---

## 3. Instalación en dev / staging (todo en el clúster)

Para levantar una instancia de pruebas con PostgreSQL y Redis incluidos dentro del namespace:

```bash
helm upgrade --install ftth ./infra/helm/ftth-copilot \
  --namespace ftth-staging --create-namespace \
  --set web.image.repository=ghcr.io/ftth-copilot/web \
  --set worker.image.repository=ghcr.io/ftth-copilot/worker
```

Accedé por port-forward si no configuraste Ingress:

```bash
kubectl -n ftth-staging port-forward svc/ftth-ftth-copilot-web 3001:80
```

---

## 4. Instalación recomendada para producción

En producción, deshabilitá el PostgreSQL y Redis embebidos e inyectá un `Secret` ya existente (por ejemplo gestionado con External Secrets Operator o Sealed Secrets) que contenga las claves `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` y `KMS_MASTER_KEY`:

```bash
helm upgrade --install ftth ./infra/helm/ftth-copilot \
  --namespace ftth-prod --create-namespace \
  --set postgresql.enabled=false \
  --set redis.enabled=false \
  --set secrets.existingSecret=ftth-prod-secrets \
  --set web.ingress.enabled=true \
  --set web.ingress.className=nginx \
  --set 'web.ingress.hosts[0].host=noc.ejemplo.invalid' \
  --set 'web.ingress.hosts[0].paths[0].path=/' \
  --set 'web.ingress.hosts[0].paths[0].pathType=Prefix' \
  --set web.autoscaling.enabled=true \
  --set worker.persistence.enabled=true \
  --set networkPolicy.enabled=true
```

---

## 5. Preservación de IP de origen en tráfico UDP (SNMP y Syslog)

El detector de syslog y traps atribuye eventos según la IP de origen del datagrama UDP (`1162/udp` y `5514/udp`). En Kubernetes, el SNAT de `kube-proxy` puede reescribir esa IP por la del nodo si no se configura correctamente:

1. **Opción recomendada (`LoadBalancer` o `NodePort`):** habilitá `worker.service.type=LoadBalancer` y `worker.service.externalTrafficPolicy=Local`. Esto evita saltos entre nodos y preserva la IP de origen del datagrama cuando el balanceador del proveedor lo soporta.
2. **Alternativa (`hostNetwork`):** si tu CNI o balanceador igualmente hace SNAT sobre UDP, podés habilitar `worker.hostNetwork=true` (el chart configura automáticamente `dnsPolicy: ClusterFirstWithHostNet`).
3. **Verificación:** probá la preservación de origen desde una red de prueba ejecutando `pnpm verify:syslog-source-ip`.

---

## 6. Validación automatizada en CI

El workflow [`.github/workflows/helm.yml`](../../.github/workflows/helm.yml) valida cada cambio en `infra/helm/**` mediante:

- `helm lint` sobre valores por defecto y perfil de producción.
- `helm template` + `kubeconform -strict -summary` para validar los manifiestos contra los esquemas de Kubernetes.
- `helm unittest` con los tests en [`infra/helm/ftth-copilot/tests/chart_test.yaml`](../../infra/helm/ftth-copilot/tests/chart_test.yaml).
- `trivy config` para detectar misconfiguraciones de seguridad (`HIGH` / `CRITICAL`).

---

## 7. Rollback y desinstalación

```bash
# Volver a la revisión anterior
helm -n ftth-prod rollback ftth 1

# Desinstalar el release completo
helm -n ftth-prod uninstall ftth
```
