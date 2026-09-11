# FTTH-Copilot — copiloto NOC/SOC y telemetría multi-fabricante para ISPs FTTH

> **Qué es:** una plataforma operativa multi-tenant que, sobre una misma infraestructura compartida (PostgreSQL, auth revocable y conectores NMS), unifica **cuatro planos de operación**: asistencia conversacional con IA, detección predictiva e investigación cognitiva de fallas (NOC / AIOps), vigilancia perimetral de seguridad (SOC) y recepción de telemetría SNMP en tiempo real compatible con **12 fabricantes de OLT**.
>
> **Por qué existe:** los operadores de ISP no disponen de tiempo para correlacionar métricas crudas, trampas SNMP dispersas ni logs de auditoría. FTTH-Copilot transforma señales débiles (deriva de potencia óptica RX, caídas dying gasp, intentos de intrusión o firmwares vulnerables) en **unidades de trabajo accionables y priorizadas**.

## El modelo mental

No pienses en FTTH-Copilot como una sola aplicación aislada. El sistema articula **cuatro planos cooperativos** sobre un núcleo multi-tenant seguro:

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Copiloto Conversacional · NOC & AIOps Cognitivo · SOC Seguridad · Telemetría SNMP │
│  (diagnóstico en LN)     · (fallas proactivas    · (auditoría    · (12 fabricantes │
│                          ·  e investigación)     ·  y ataques)   ·  v1/v2c/v3)     │
└──────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                        Base Compartida Multi-Tenant
         (Auth JWT + sesiones revocables en PG + cifrado KMS + conectores NMS)
```

| Plano | Qué resuelve | Señal que consume | Estado en runtime |
|---|---|---|---|
| **Copiloto** | "¿Cuántas ONUs están offline en esta OLT y qué causa predomina?" | Datos vivos del NMS (SmartOLT, Mikrowisp) | Activo en `/app` |
| **NOC & AIOps** | "¿Qué enlace o puerto va a fallar y cuál es la hipótesis raíz?" | Series temporales de métricas (RX, temp) y topología | Poller en segundo plano |
| **SOC** | "¿Hay ataques de fuerza bruta o equipos con firmware vulnerable?" | Syslog UDP y catálogo de CVEs | Receptor UDP 5514 |
| **Telemetría SNMP** | "¿Qué alarmas físicas están emitiendo las OLTs de la red?" | Trampas SNMP binarias (v1, v2c, v3 authPriv) | Receptor UDP 162 |

Los cuatro planos comparten los mismos principios de arquitectura: **cada conector y adaptador es tenant-aware, nunca cae silenciosamente a fixtures en producción, y toda acción sensible está respaldada por permisos en PostgreSQL y sanitización estricta de credenciales.**

## Quick path (Inicio local)

Requisitos: Node.js 22+, pnpm 11+ y PostgreSQL 16+.

```bash
# 1. Preparar entorno y variables
cp .env.example .env
# Configurar DATABASE_URL, KMS_MASTER_KEY, JWT_SECRET y MINIMAX_API_KEY

# 2. Instalar dependencias y migrar base de datos
pnpm install
pnpm --filter @ftth-copilot/db db:migrate

# 3. Iniciar entorno de desarrollo
pnpm dev
```

Abrí `http://localhost:3001` en el navegador.

`pnpm install` genera automáticamente el cliente Prisma mediante su hook `postinstall`. También podés regenerarlo manualmente con `pnpm db:generate`.

## Los cuatro planos en detalle

### 1. Copiloto conversacional
- **Qué es:** un agente conversacional en lenguaje natural dotado de herramientas NMS específicas para FTTH.
- **Cómo funciona:** el ciclo de ejecución reside en `packages/agent-core`. Cada sesión está aislada por tenant y aplica límites atómicos de velocidad por usuario/minuto y cuota diaria compartida en PostgreSQL.
- **Superficie de uso:** interfaz de chat en `/app`, tablero operativo en `/dashboard` y endpoints `/api/chat`, `/api/dashboard` y `/api/alerts`.

### 2. NOC — detección proactiva & AIOps cognitivo
- **Qué es:** un poller periódico de métricas ópticas sumado a un motor determinista y cognitivo de investigación de fallas.
- **Detección continua:** evalúa series temporales contra algoritmos estadísticos robustos (mediana + MAD) para detectar:
  - Deriva de potencia óptica RX hacia umbral crítico (−27 dBm) con cálculo de ETA de desconexión.
  - Deriva de temperatura en chasis OLT/placas hacia 60 °C.
  - Inestabilidad de enlace (flapping recurrente).
  - Reinicios espurios de equipamiento.
- **Investigación cognitiva:** motor en `packages/agent-core` que ante un incidente recolecta hechos verificables, descarta fallas correlacionadas en topología y formula hipótesis diagnósticas auditables bajo el contrato `ftth.investigation-result.v1`.
- **Superficie de uso:** panel "Fallas pronosticadas" en el dashboard, tarjeta de investigación en incidentes y `GET /api/predictions`.

### 3. SOC — seguridad perimetral
- **Qué es:** receptor syslog UDP y analizadores que transforman eventos de red crudos en hallazgos de seguridad accionables.
- **Detectores activos:**
  - **Fuerza bruta:** ≥ 5 fallos de autenticación desde la misma IP en una ventana de 5 minutos.
  - **Acceso tras fallos:** inicio de sesión exitoso posterior a ≥ 3 intentos fallidos inmediatos.
  - **Cambio de configuración:** detección de eventos `config_change` para trazabilidad de cambios no autorizados.
  - **Auditoría de firmware:** escaneo periódico contra inventario de versiones con CVEs documentadas.
- **Superficie de uso:** panel "Accesos" en el dashboard y endpoint `GET /api/security/access`.

### 4. Telemetría SNMP & Laboratorio Multi-Fabricante
- **Qué es:** subsistema de recepción e interpretación de trampas SNMP de bajo nivel para OLTs de múltiples marcas.
- **Capacidades clave:**
  - Receptor binario UDP nativo (`createManagedSnmpReceiver`) con soporte para SNMPv1, SNMPv2c y **SNMPv3** con cifrado y autenticación completa (`authPriv` / `authNoPriv`, MD5, SHA, SHA-256, DES, AES-128, AES-256).
  - Soporte de mensajes `InformRequest` con emisión de confirmaciones `InformResponse` (PDU ACK).
  - Resolución canónica de identidad de dispositivo (`resolveDeviceIdentity`, PEN IANA) y detección de ambigüedad de remitentes.
  - **Aislamiento multi-tenant:** arnés de seguridad `executeAdapterSafe` que impide que un adaptador modifique el `tenantId` o infle severidades unilateralmente.
  - **Protección contra inundaciones:** guardia `createSnmpIngestionGuard` con token bucket y deduplicación basada en huella SHA-256.
  - **Sanitización de evidencia:** redacción de credenciales, tokens y comunidades SNMP en crudo (`createRawEvidenceEnvelope`).
  - **Aislamiento semántico provisional:** OIDs sin confirmación de laboratorio físico emiten `provisionalTrap` (info) y resguardan el diagnóstico candidato de manera pasiva en métricas, prohibiendo la activación en entornos de producción (`NODE_ENV === 'production'`).

## Matriz de compatibilidad OLT (12 fabricantes)

El catálogo incluye **64 definiciones auditadas** y **69 OIDs únicos** libres de colisiones semánticas, respaldados por manuales técnicos y MIBs en `packages/monitoring/src/snmp/research/sources.yaml`.

| Fabricante | PEN IANA | Nivel de Soporte | Familias Validadas en Laboratorio |
|---|---|---|---|
| **Huawei** | 2011 | L2 Adapter | MA5600, MA5800 |
| **ZTE** | 3902 | L2 Adapter | C300, C600 |
| **Nokia** | 637 / 6527 | L2 Adapter | 7360 ISAM, Lightspan FX |
| **FiberHome** | 3807 | L2 Adapter | AN5516, AN6000 |
| **Calix** | 1251 | L2 Adapter | E7-2, AXOS series |
| **Adtran** | 664 | L2 Adapter | Total Access 5000 (TA5000) |
| **VSOL** | 37950 | L2 Adapter | V1600G series |
| **BDCOM** | 3320 | L2 Adapter | P3600, GP3600 |
| **C-Data** | 34592 | L1 Definition | FD1100, FD1200, FD1600 |
| **DZS** | 368 | L1 Definition | V5800, V8100 series |
| **Ubiquiti** | 41112 | L1 Definition | UFiber OLT, UFiber OLT 4 |
| **Zyxel** | 890 | L1 Definition | OLT1404A, OLT1408A, OLT2406 |
| **Standard RFC** | 0 | L2 Adapter | RFC 2863 IF-MIB (linkUp, linkDown) |
| **Generic xPON** | 0 | L2 Adapter | Interfaz ITU-T G.984 / G.988 genérica |

El detalle completo de OIDs, severidades y fuentes documentales se encuentra en [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md).

## Conectores NMS soportados

- **SmartOLT:** conector HTTP de producción y fixtures de laboratorio.
- **Mikrowisp:** conector HTTP de producción y fixtures de laboratorio.
- **NetSense:** en roadmap; la API rechaza explícitamente la conexión sin sustituir datos con mocks.

El modo demostración se habilita únicamente con `DEMO_MODE_ENABLED=true`. En este modo, la UI y el copiloto advierten explícitamente que los datos son sintéticos. En producción debe permanecer siempre en `false`.

## Seguridad y políticas de red

- **Protección SSRF en NMS:** las URLs NMS utilizan HTTPS y puerto 443 por defecto, resuelven vía DNS previo al socket, prohíben rangos privados/metadata cloud y pueden restringirse mediante `NMS_ALLOWED_HOSTS`. Las excepciones LAN requieren opt-in explícito (`NMS_ALLOW_PRIVATE_NETWORKS=true`).
- **Autenticación:** sesiones JWT en cookies `HttpOnly`, revocables de forma inmediata en PostgreSQL.
- **Protección de costos de LLM:** rate limiter atómico en PostgreSQL por usuario y minuto (`CHAT_RATE_LIMIT_PER_MINUTE`), con cuota diaria estricta (`CHAT_DAILY_QUOTA`).
- **Cifrado en reposo:** claves de API y credenciales NMS protegidas con cifrado simétrico autenticado AES-256-GCM (`KMS_MASTER_KEY`).

## Variables de entorno clave

Todas las opciones están tipadas y documentadas en [`.env.example`](.env.example):

| Bloque | Variables principales | Propósito |
|---|---|---|
| **NOC Poller** | `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_MS`, `METRICS_RETENTION_DAYS` | Muestreo en background de métricas ópticas |
| **NOC Alertas** | `ALERT_WEBHOOK_URL`, `ALERT_COOLDOWN_MS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Despacho de incidentes proactivos |
| **SOC Syslog** | `SYSLOG_RECEIVER_ENABLED`, `SYSLOG_UDP_PORT`, `SYSLOG_TENANT_ID` | Receptor y analizador de syslog |
| **SOC Firmware** | `FIRMWARE_AUDIT_ENABLED`, `FIRMWARE_AUDIT_INTERVAL_MS` | Auditoría de versiones vulnerables de ONT/OLT |
| **Red NMS** | `NMS_REQUEST_TIMEOUT_MS`, `NMS_ALLOWED_HOSTS`, `NMS_ALLOW_PRIVATE_NETWORKS` | Políticas de egreso y seguridad SSRF |
| **Chat & LLM** | `MINIMAX_API_KEY`, `LLM_PROVIDER`, `CHAT_RATE_LIMIT_PER_MINUTE`, `CHAT_DAILY_QUOTA` | Proveedores y control de gasto de inferencia |

## Comandos de desarrollo y verificación

### Validación estándar del monorepo
```bash
pnpm lint                  # Análisis estático ESLint en todos los paquetes
pnpm typecheck             # Comprobación estricta de tipos TypeScript
pnpm test                  # Suite completa de pruebas unitarias
pnpm test:coverage-check   # Verificación de umbrales mínimos de cobertura
pnpm build                 # Compilación de todos los paquetes y apps
pnpm test:e2e              # Pruebas end-to-end con Playwright
```

### Gobernanza y laboratorio SNMP / Fabricantes
```bash
pnpm check:sources         # Verifica que no haya deriva entre el registro de fuentes y la matriz
pnpm check:conflicts       # Escanea colisiones semánticas y solapamientos de OID
pnpm check:contribution    # Valida admisión de paquetes de fabricantes (Gate 1 y Gate 8)
pnpm test:conformance      # Ejecuta el laboratorio de conformidad y golden snapshots (31/31)
pnpm benchmark:snmp        # Benchmark sintético de throughput de procesamiento SNMP
pnpm generate:matrix:write # Regenera docs/compatibility-matrix.md desde las fuentes
```

## Estructura del monorepo

Organización por paquetes según su dominio de responsabilidad:

| Paquete | Responsabilidad principal |
|---|---|
| `apps/web` | Aplicación Next.js App Router, tablero NOC/SOC, tarjeta de investigación y rutas API |
| `packages/agent-core` | Bucle de razonamiento del agente, selección de tools y motor de investigación cognitiva |
| `packages/alerts` | Deduplicación, agrupamiento, escalado y despacho de notificaciones (webhook/Telegram) |
| `packages/analytics` | Recolección, agregación y persistencia de series temporales de métricas |
| `packages/connectors/core` | Tipos comunes y política estricta de red para conectores externos |
| `packages/connectors/smartolt` | Adaptador para la API de SmartOLT (HTTP real y fixtures de prueba) |
| `packages/connectors/mikrowisp` | Adaptador para la API de Mikrowisp (HTTP real y fixtures de prueba) |
| `packages/db` | Esquema Prisma, cliente tipado, migraciones y cifrado KMS (AES-256-GCM) |
| `packages/detection` | Algoritmos estadísticos deterministas y detectores de derivas físicas |
| `packages/eval` | Marco de evaluación estricto (attack-pass-rate 100%) y control de tenants piloto |
| `packages/evidence` | Recolección de evidencia normalizada y fixtures de investigación |
| `packages/monitoring` | Receptor binario SNMP, adaptadores multi-vendor OLT, catálogo y conformance lab |
| `packages/security` | Analizador de paquetes syslog RFC 3164/5424 y clasificadores de eventos SOC |
| `packages/shared` | Esquemas Zod y contratos canónicos de telemetría e incidentes compartidos |
| `packages/soc` | Orquestación de la ingestión de seguridad, correlación y auditoría de firmware |

## Próximos pasos y documentación técnica

- [Arquitectura detallada del sistema](docs/architecture.md) — Modelo de datos, flujos entre paquetes y garantías de aislamiento.
- [Matriz de compatibilidad OLT](docs/compatibility-matrix.md) — Catálogo de OIDs soportados, severidades y fuentes documentales.
- [Pruebas de laboratorio sin hardware](docs/testing-without-hardware.md) — Guía para simular trampas SNMP y escenarios complejos de red.
- [Evolución hacia AIOps cognitivo](docs/aiops-roadmap.md) — Hojas de ruta sobre análisis multivariado y correlación topológica.

## Nota operativa sobre Cloudflare

Una credencial de Cloudflare Tunnel figuró en versiones anteriores del historial público. Fue rotada en Cloudflare Zero Trust y la credencial expuesta quedó invalidada.

## Licencia

Propietario — todos los derechos reservados. Copyright © 2026 TecnoDespegue / René Kuhm.

Este repositorio **no** está bajo una licencia de código abierto. El acceso público se concede únicamente para su revisión y evaluación: no puede usarse, copiarse, modificarse ni redistribuirse (total o parcialmente) sin autorización expresa y por escrito del titular. Consultar [`LICENSE`](LICENSE).
