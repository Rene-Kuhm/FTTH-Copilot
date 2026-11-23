# Verificar los controles de seguridad en local

Ejecutá las comprobaciones estáticas desde la raíz del monorepo.

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
