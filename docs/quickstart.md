# Quickstart — FTTH-Copilot

> **Objetivo:** llegar a un diagnóstico funcional en 5 minutos o menos,
> sin credenciales reales de NMS.

---

## Paso 0 — ¿Qué querés evaluar?

| Si querés... | Ir a |
|---|---|
| Probar la interfaz y el chat sin instalar nada | [Demo rápido (Docker)](#opción-1-demo-rápido-docker) |
| Desarrollar o extender el código | [Entorno de desarrollo local](#opción-2-desarrollo-local-pnpm) |
| Desplegar en un servidor para evaluación de producción | [Producción (install.sh)](#opción-3-producción-installsh) |

---

## Opción 1 — Demo rápido (Docker)

**Tiempo estimado: 3–5 minutos · Requiere: Docker + Docker Compose**

### 1. Verificá que Docker esté disponible

```bash
docker --version
docker compose version
```

Si no los tenés, instalalos desde [docker.com/get-started](https://docs.docker.com/get-started/).

### 2. Levantá todo con un comando

```bash
./scripts/run-demo.sh
```

El launcher:
1. Crea `.env` a partir del template de demo (credenciales pre-configuradas)
2. Compila la imagen Docker (~2 min la primera vez)
3. Inicia PostgreSQL, corre migraciones, siembran datos sintéticos y levanta la app
4. Imprime las credenciales en la consola

### 3. Abrí la interfaz

Cuando veas `✓ Demo data seeded` en la consola, abrí:

```
http://localhost:3001
```

**Credenciales de demo:**

| Campo | Valor |
|---|---|
| Email | `admin@ftth-copilot.local` |
| Contraseña | `demo12345` |

### 4. ¿Funcionó?

Si la página carga y ves el dashboard con alertas, el demo está operativos.

> **Primer diagnóstico en el chat:** probá preguntar
> `"¿Cuáles ONUs están offline?"` — deberías ver las 4 ONUs offline
> del escenario de planta externa.

### 5. Detener el demo

```bash
./scripts/run-demo.sh down
```

Para borrar todo y empezar de nuevo:

```bash
./scripts/run-demo.sh reset
```

---

## Opción 2 — Desarrollo local (pnpm)

**Tiempo estimado: 5–10 minutos · Requiere: Node.js 22+, pnpm 11+**

### 1. Verificá los requisitos

```bash
node --version   # debe ser ≥ 22
pnpm --version   # debe ser ≥ 11
```

### 2. Cloná y arrancá

```bash
git clone https://github.com/Rene-Kuhm/FTTH-Copilot.git
cd FTTH-Copilot

pnpm install
pnpm run setup   # asistente interactivo: configura .env, claves, migra y siembra
pnpm dev
```

El comando `setup` es interactivo. Responde las preguntas o ejecutá
`pnpm run setup -- --non-interactive` para un entorno automatizado.

### 3. Abrí la interfaz

```
http://localhost:3001
```

**Credenciales:** el comando `setup` imprime la contraseña temporal en la consola.

### 4. Para usar datos de demo

Agregá esto a tu `.env`:

```bash
DEMO_MODE_ENABLED=true
SMARTOLT_USE_MOCK=true
```

Luego reiniciá con `pnpm dev`.

---

## Opción 3 — Producción (install.sh)

**Tiempo estimado: 10–15 minutos · Requiere: Linux/macOS + Docker**

### 1. Descargá y ejecutá el instalador

```bash
curl -fsSL https://raw.githubusercontent.com/Rene-Kuhm/FTTH-Copilot/main/install.sh | bash -s -- --non-interactive
```

O, si ya tenés el repositorio:

```bash
./install.sh
```

El instalador pregunta por:
- Puerto de la app (por defecto 3001)
- Provider de IA (opcional, puede dejarse vacío para evaluación offline)
- Credenciales de PostgreSQL

### 2. Credenciales iniciales

Al terminar, el instalador imprime la contraseña del admin. Guardala.

### 3. Verificá que esté funcionando

```bash
curl http://localhost:3001/api/health
```

Debería devolver `{"status":"ok","database":"ok"}`.

---

## Troubleshooting

### "Puerto ya está en uso"

```bash
# Averiguá qué está usando el puerto
lsof -i :3001       # macOS
ss -tlnp | grep 3001  # Linux

# Detené el proceso o cambiá el puerto en .env
PORT=3002
```

### "Docker: permission denied"

```bash
# Agregá tu usuario al grupo docker
sudo usermod -aG docker $USER
# Luego cerrá sesión y volvé a abrirla, o ejecutá:
newgrp docker
```

### "Error de conexión a PostgreSQL"

```bash
# Verificá que postgres esté corriendo
docker ps | grep postgres

# Si no está, levantalo
docker compose -f docker-compose.demo.yml up postgres -d

# Esperá a que esté healthy (~5s)
docker compose -f docker-compose.demo.yml ps
```

### "Error: KMS_MASTER_KEY not configured"

Ejecutá `pnpm run setup` o generá la clave manualmente:

```bash
openssl rand -hex 32
# Copiá la salida a KMS_MASTER_KEY= en .env
```

### "La UI carga pero el chat no responde"

1. Verificá que `LLM_PROVIDER` esté configurado en `.env` (o vacío para modo offline)
2. Verificá que `DEMO_MODE_ENABLED=true` si querés usar el mock
3. Revisá los logs:

```bash
docker compose logs app --tail=50
```

### "pnpm dev funciona pero el demo Docker no"

```bash
# Verificá que la imagen se haya reconstruido
docker compose -f docker-compose.demo.yml build --no-cache app

# O usá la versión cacheada
docker compose -f docker-compose.demo.yml up --force-recreate
```

### "Seed falló con: Refusing to seed database"

Esto es una protección intentional en producción. Verificá que:

```bash
# .env no tenga NODE_ENV=production
grep NODE_ENV .env
```

Si estás en desarrollo, asegurate de que `NODE_ENV=development` o está ausente.
El seed de demo se permite con `ALLOW_PRODUCTION_SEED=true`.

### "¿Cómo verifico que los datos sintéticos están cargados?"

En la UI:
1. Andá a **Dashboard > Alertas**
2. Deberías ver 4 alertas (2 critical de ONUs offline, 1 warning de señal degradada, 1 warning de OLT con temperatura)

Por API:

```bash
curl -s http://localhost:3001/api/health | jq .
```

### "¿Cómo limpio todo y empiezo de nuevo?"

```bash
# Modo demo
./scripts/run-demo.sh reset

# Modo desarrollo
docker compose down -v
rm .env
pnpm run setup
```

---

## Próximo paso

¿Llegaste al dashboard? El [walkthrough de 5 minutos](./walkthrough.md) te lleva
por un diagnóstico completo de offline-ONU paso a paso.
