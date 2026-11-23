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

Generá las referencias en Linux con la misma versión de Chromium y las mismas fuentes locales que se usarán para comparar. Ejecutá `pnpm --filter @ftth-copilot/web test:visual:update` y revisá los diez PNG en `apps/web/e2e/visual/screens.spec.ts-snapshots/` antes de versionarlos. Después ejecutá `test:visual` para comprobar la comparación. Una ejecución normal falla si falta una referencia. Los fallos dejan artefactos en `apps/web/test-results/a11y-visual/`.
