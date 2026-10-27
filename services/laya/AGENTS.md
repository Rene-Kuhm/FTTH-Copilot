# AGENTS.md — `services/laya`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

El despliegue **opcional** del Expert System Laya como servicio FastAPI, para escenarios Docker y
procesamiento por lotes. La implementación de referencia está en TypeScript, en
`packages/shared/src/laya-expert-system.ts`.

## Qué invariantes cuida

- **Este servicio no es la fuente de verdad.** La referencia es el módulo TypeScript; los patrones
  de clasificación tienen que seguir en sincronía con él.
- **Es una despliegue, no una dependencia.** El pipeline principal funciona sin Laya: el modo
  `fail-open` (`LAYA_FAIL_OPEN`) cubre la caída del servicio.
- **Sin datos reales.** Los ejemplos y las pruebas usan datos sintéticos.

## Cómo se prueba

```bash
python3 -m py_compile services/laya/app.py
```

El servicio se levanta con Docker; su imagen fija la versión de Python.

## Qué no tocar

- `Dockerfile` y `requirements.txt` sin revisar el pinning de dependencias: es lo que hace
  reproducible el despliegue.
- Los patrones de clasificación sin sincronizarlos con `packages/shared`.

## Superficie pública

`app.py` expone `/health`, `/decide` y `/classify`, con los esquemas `DecisionRequest` y
`DecisionResponse`. El esqueleto completo lo imprime `mise run repo-map`.
