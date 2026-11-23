# Verificar los controles de seguridad en local

Ejecutá las comprobaciones estáticas desde la raíz del monorepo. La suite HTTP usa una instancia Next.js en modo producción, con sesiones reales, dos tenants sintéticos y servicios propios de Postgres y Redis.

## Análisis estático y dependencias

```bash
pnpm security:sast
```

El comando ejecuta las tres etapas, incluso si alguna falla. Cada etapa también se puede ejecutar por separado.

| Comando | Qué comprueba |
| --- | --- |
| `pnpm security:sast:eslint` | Reglas seleccionadas de seguridad en la app web y el código fuente de paquetes y servicios. Excluye salidas de build y archivos generados. |
| `pnpm security:sast:semgrep` | Reglas locales declaradas en `scripts/security/semgrep.yml`. Requiere Semgrep en `PATH` y falla ante coincidencias o errores de análisis. |
| `pnpm security:audit` | Avisos de dependencias del lockfile. Requiere acceso al registro de paquetes configurado. |

Una herramienta ausente o un registro inaccesible dejan el chequeo fallido. Revisá cada hallazgo antes de editar código o actualizar dependencias.

## Pruebas HTTP con datos sintéticos

Usá un worktree de pruebas con las dependencias y el cliente Prisma preparados. Docker Compose necesita las imágenes declaradas en [el archivo de servicios](../apps/web/security-e2e/compose.yml), descargadas de antemano, y los puertos locales `3011`, `55444` y `16344` libres.

```bash
docker compose -f apps/web/security-e2e/compose.yml up --pull never --wait
pnpm security:dast
```

Playwright aplica las migraciones existentes y construye la app antes de escuchar en `127.0.0.1:3011`. Cada ejecución genera claves efímeras y usuarios únicos. Se usa la URL fija de Postgres del stack de auditoría y el endpoint de salud espera una conexión a esa base. Corré esta suite con el entorno local de pruebas y sin otra instancia de Next.js en el mismo worktree, ya que el build usa el directorio `.next` de la app.

| Control | Aserción HTTP |
| --- | --- |
| Aislamiento por tenant | Los dos propietarios ven exactamente los usuarios de su tenant. |
| Autorización | La gestión de usuarios exige una sesión válida y devuelve 403 al operador. |
| CSRF y validación | Una mutación sin cabecera CSRF recibe 403. Con la cabecera válida, un cuerpo que no cumple el esquema recibe 400. |
| Cabeceras | La respuesta autenticada incluye CSP, HSTS y cabeceras contra el framing y la detección de tipos MIME. |
| Cuota de login | Tras tres fallos, el siguiente intento recibe 429 con `Retry-After`. |
| Política SSRF | Un alta de conector con una IP de documentación fuera de la allowlist recibe 400. La matriz de rangos y excepciones se cubre en `@ftth-copilot/connectors-core`. |

`pnpm security:dast --list` enumera los casos sin arrancar la app. Con el stack iniciado, `pnpm security:check` ejecuta SAST y después las pruebas HTTP si SAST pasa.

Para descartar los datos sintéticos y liberar los puertos al terminar, bajá el proyecto de Compose dedicado a la auditoría.

```bash
docker compose -f apps/web/security-e2e/compose.yml down -v
```
