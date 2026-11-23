# Accesibilidad y regresión visual de la web

Las suites revisan diez pantallas de FTTH-Copilot en Chromium con datos de un tenant inventado. Playwright intercepta las APIs y bloquea el tráfico externo. La aplicación se sirve con Next.js en loopback y las pruebas no requieren PostgreSQL ni conectores NMS.

## Ejecutar

Desde la raíz del repositorio, con las dependencias instaladas:

```bash
pnpm --filter @ftth-copilot/web exec playwright install chromium
pnpm --filter @ftth-copilot/web build:e2e
pnpm --filter @ftth-copilot/web test:a11y
pnpm --filter @ftth-copilot/web test:visual
```

`test:a11y-visual` ejecuta ambas suites. El servidor de estas pruebas tiene su propia configuración y usa el puerto 3418. Si está ocupado, elegí otro con `E2E_PORT`. Los E2E funcionales siguen disponibles con `pnpm test:e2e`.

| Cobertura | Qué comprueba |
| --- | --- |
| Accesibilidad | Reglas WCAG 2.x A/AA de axe, incluido contraste. Pruebas de teclado para Tab, Shift+Tab, foco visible, Enter y Espacio. Verificaciones de roles y nombres accesibles para formularios, navegación y controles de alertas. |
| Regresión visual | Capturas de página completa en 1440 × 1000, tema oscuro, zona UTC y hora fija. Playwright espera datos visibles y fuentes listas. |
| Pantallas | Inicio, login, alta, documentación, Copilot, tablero, métricas, Laya, alertas y planos en estado vacío. |

Cada auditoría adjunta las violaciones y las comprobaciones inconclusas de axe a su resultado. Las violaciones hacen fallar la prueba. Las comprobaciones inconclusas requieren revisión manual.

## Generar y revisar capturas

Las referencias dependen de las fuentes del sistema, así que **se generan dentro de la imagen oficial de Playwright** (`mcr.microsoft.com/playwright`), la misma que usa el CI, y no en el equipo de quien desarrolla. `scripts/ui-quality-docker.sh` lo automatiza (necesita Docker; copia el árbol a un directorio temporal y corre el contenedor con tu usuario, así no deja archivos de `root`):

```bash
scripts/ui-quality-docker.sh update   # regenera los diez PNG
scripts/ui-quality-docker.sh check    # a11y + visual + matriz de compatibilidad
```

Revisá los diez PNG en `apps/web/e2e/visual/screens.spec.ts-snapshots/` antes de versionarlos. Una ejecución normal falla si falta una referencia, y los fallos dejan artefactos en `apps/web/test-results/a11y-visual/`. Si solo querés mirar una pantalla en tu equipo, `test:visual` local sirve, pero sus capturas **no** son comparables con las versionadas.

## En el CI

El job `ui-quality` de `.github/workflows/ci.yml` corre las tres suites (accesibilidad, regresión visual y la matriz de `docs/testing-without-hardware.md`) dentro de esa imagen, en cada pull request. Forma parte del gate `CI Success`: si falla, el merge queda bloqueado.
