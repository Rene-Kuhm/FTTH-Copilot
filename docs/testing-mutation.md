# Mutation testing con StrykerJS

Medí si los tests detectan cambios de comportamiento en los detectores, el recolector de
evidencia y las utilidades compartidas. StrykerJS genera mutantes y usa el runner de Vitest
para determinar cuáles hacen fallar la suite.

## Ejecutar

```bash
pnpm test:mutation
pnpm --filter @ftth-copilot/detection test:mutation
pnpm --filter @ftth-copilot/evidence test:mutation
pnpm --filter @ftth-copilot/shared test:mutation
```

Cada paquete declara StrykerJS y su runner como dependencias de desarrollo y reutiliza su
configuración de Vitest. El comando raíz ejecuta solo los tres scripts de mutación, sin caché.
Los reportes HTML y JSON quedan en `reports/mutation/` dentro de cada paquete. Stryker
instrumenta una copia temporal bajo `.stryker-tmp/` y usa un socket TCP local para comunicar
los logs de sus workers.

La mutación cubre `src/**/*.ts` y excluye los barrels y archivos de tipos indicados en las
configuraciones. En `shared` también quedan fuera `src/contracts.ts` y `src/design-system/`.
El análisis `perTest` usa la cobertura para seleccionar tests relacionados. Si un mutante
aparece como sobreviviente o sin cobertura y el resultado es inesperado, se puede
contrastar sin esa selección por cobertura:

```bash
pnpm --filter @ftth-copilot/evidence test:mutation --coverageAnalysis off
```

## Línea base y resultado

Medición con StrykerJS 10.1.1, Vitest 4.1.12 y Node 22.23.3.

| Paquete | Línea base | Score final | Muertos nuevos | Mutantes totales |
|---|---:|---:|---:|---:|
| `detection` | 72,43% | 82,52% | 56 | 555 |
| `evidence` | 76,14% | 77,24% | 16 | 1463 |
| `shared` | 59,28% | 63,47% | 55 | 1325 |

Stryker cuenta los timeouts como detectados y excluye los errores de ejecución del
denominador. En estas mediciones se mantuvieron 8 timeouts en `evidence` y 2 en `shared`,
además de 11 errores de ejecución en `shared`.

- **Detection.** Los tests verifican ventanas cerradas y muestras desordenadas, límites de
  severidad de LOS, FEC y tráfico, y el ajuste estadístico y horizonte de una predicción.
- **Evidence.** Los tests verifican que topología, incidentes y feedback de otro tenant
  se descarten incluso cuando los identificadores coinciden. También cubren timestamps
  inválidos y los límites de la ventana.
- **Shared.** Los tests verifican la redacción de credenciales sintéticas, el plazo de
  recuperación del circuit breaker y la retención, cálculo y exportación de métricas.

Quedan sobrevivientes en la validación de frescura de `evidence`, en las predicciones de
deriva térmica de `detection` y en la normalización de respuestas y el procesamiento batch
de Laya en `shared`. Los umbrales de referencia son informativos y la ejecución queda
habilitada como diagnóstico local. Un incremento posterior puede aplicar un umbral de
fallo tras confirmar la estabilidad de estas mediciones en CI.
