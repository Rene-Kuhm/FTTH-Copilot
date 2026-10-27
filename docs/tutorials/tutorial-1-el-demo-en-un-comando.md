# Tutorial 1 — El demo en un comando

**Objetivo:** levantar el producto completo con Docker, entrar a la interfaz y ver el
dashboard con datos sintéticos. Terminás con una URL abierta y un dashboard con alertas.

**Requiere:** Docker y Docker Compose. **No** requiere hardware, ni NMS, ni claves de API.

---

## 1. Verificá que Docker está disponible

```bash
docker --version
docker compose version
```

## 2. Levantá el demo

```bash
./scripts/run-demo.sh
```

El launcher hace cinco cosas:

1. Crea el `.env` a partir de `docs/demo-env-template.md`.
2. Compila la imagen Docker (la primera vez tarda unos 2 minutos).
3. Levanta PostgreSQL y corre las migraciones.
4. Siembra datos sintéticos.
5. Levanta la app y VictoriaMetrics.

Vas a ver `✓ Demo data seeded` cuando termine.

## 3. Abrí la interfaz

```
http://localhost:3001
```

Credenciales del demo:

| Campo | Valor |
|---|---|
| Email | `admin@ftth-copilot.local` |
| Contraseña | `demo12345` |

> La contraseña viene de `SEED_ADMIN_PASSWORD` en el template del demo
> (`docs/demo-env-template.md`). En un entorno propio, el seed genera una contraseña
> aleatoria de 12 bytes si no la definís
> (`packages/db/prisma/seed.ts:307`).

## 4. Hacé tu primera consulta

En el chat, preguntá:

```
¿Cuáles ONUs están offline?
```

Vas a ver una respuesta con las ONUs offline del escenario de planta externa.

## 5. Recorré el dashboard

Después de la consulta, mirá `/dashboard`. Vas a encontrar:

- **Incidentes** — alertas agrupadas por equipo.
- **Predicciones** — las alertas abiertas.
- **Disponibilidad (SLA)** — el uptime por dispositivo, con el `coveragePercent` al lado.
- **Accesos** — los eventos de seguridad del pipeline SOC.

Si el panel de Accesos está vacío, es lo esperado: el receptor syslog está **apagado** en
el demo (`SYSLOG_RECEIVER_ENABLED` no está en el template). El plano SOC se enciende
explícitamente; ver [Habilitar NOC y SOC](../how-to/habilitar-noc-y-soc.md).

## 6. Verificá que el sistema está vivo

En otra terminal:

```bash
curl -s http://localhost:3001/api/health | head -40
```

Deberías ver `"status":"ok"` y el bloque `services` con los schedulers.

Y las métricas Prometheus:

```bash
curl -s http://localhost:3001/api/metrics | grep ftth_copilot | head -20
```

En el demo `METRICS_BEARER_TOKEN` está vacío, así que el endpoint es abierto.

## 7. Detené el demo

```bash
./scripts/run-demo.sh down
```

Para borrar todo, incluido el volumen de Postgres, y arrancar de cero:

```bash
./scripts/run-demo.sh reset
```

`reset` borra el `.env` también.

---

## Qué acabás de ver

El demo corre con `DEMO_MODE_ENABLED=true` y `SMARTOLT_USE_MOCK=true`: el chat, el
dashboard y las alertas usan los **fixtures** de SmartOLT y Mikrowisp, no un NMS real
(`apps/web/lib/connectors/chat-client.ts:144`). El demo está pensado para que ninguna
consulta salga a la red.

Con el fixture de SmartOLT hay 5 OLTs y 42 ONUs, con escenarios de falla embebidos.

## Si algo falla

- **`port is already allocated`** → tenés algo en el 3001 o el 5432. `run-demo.sh` los
  revisa al arrancar (`scripts/run-demo.sh:12`).
- **La página carga pero no hay datos** → el seed no terminó. Revisá `docker compose -f
  docker-compose.demo.yml logs db-seed`.
- **`cannot reach database`** → el contenedor de Postgres no está listo; esperá el healthcheck
  y volvé a correr `./scripts/run-demo.sh`.

## Siguiente

Ya tenés el producto corriendo. Ahora mirá **qué pasa por dentro** cuando hacés una
consulta: [Tutorial 2 — Tu primera consulta](tutorial-2-tu-primera-consulta.md).
