# Documentación viva (zero-drift)

La documentación de este repo no es una foto: es código que se verifica. Cada ejemplo de
`README.md` y de `docs/` se contrasta contra el estado real del repositorio, y un ejemplo roto
deja el CI en rojo.

```bash exec
node -e "console.log('la documentación se ejecuta en CI')"
```

## Qué verifica `mise run docs-test`

El runner es [`scripts/docs-test.ts`](../../scripts/docs-test.ts). Extrae los bloques de código de
todos los Markdown de `README.md`, de `docs/` y de los `AGENTS.md` del repo, y los contrasta contra
el repo:

| Tipo de bloque | Qué se verifica | Error si… |
|---|---|---|
| `bash` / `sh` / `console` | Sintaxis (`bash -n`), scripts de `pnpm`/`npm`, tareas de `turbo.json` y de `mise.toml`, archivos del repo que el ejemplo da por existentes, sintaxis de los `cd` con su paquete | el ejemplo llama a un script o a un archivo que no existe |
| `ts` / `typescript` / `js` | Sintaxis, y que cada import de `@ftth-copilot/*` exista de verdad en la API pública del paquete, y que cada import `@/...` resuelva a un archivo de `apps/web` | la documentación importa un símbolo que el paquete ya no exporta |
| `json` | Que el JSON parsea | el ejemplo es JSON inválido |
| `yaml` | Que el YAML parsea | el ejemplo es YAML inválido |
| `env` | Que cada variable exista en `.env.example` o en `turbo.json` | la app declara el prefijo pero no esa variable (p. ej. `METRICS_*` existe, `METRICS_POLLER_ENABLDD` no) |
| `python` | Que el fragmento compila | el ejemplo no es Python válido |
| `mermaid` | Que el diagrama balancea sus llaves y corchetes | el diagrama está roto |

Un bloque `bash` que solo consulta versiones (`node --version`, `pnpm --version`) **se ejecuta** de
verdad. Un bloque marcado con el atributo `exec` también se ejecuta:

````markdown
```bash exec
node -e "console.log('la documentación se ejecuta en CI')"
```
````

## Dos capas: validar y ejecutar

No todo ejemplo puede ejecutarse en CI: muchos necesitan Docker, Postgres o un servidor ya
levantado. Por eso hay dos capas, y el runner informa de cuál aplicó a cada bloque.

1. **Validación** — el ejemplo se contrasta contra el repo: lo que el ejemplo afirma tiene que
   existir. Es la capa que cubre el 95% de los ejemplos.
2. **Ejecución** — el ejemplo corre de verdad. Se aplica a los bloques marcados con `exec` y a los
   que solo piden versiones de herramientas.

Un bloque que necesita servicios externos **no** se marca con `exec`: se deja como está y su
comando se valida. Si lo marcás con `exec`, el CI lo corre y falla si el servicio no está.

## Cómo escribir un ejemplo que no se rompa

- **Usá los comandos que el repo expone.** `pnpm <script>` tiene que existir en el
  `package.json` raíz o en el paquete del que habla el ejemplo. Si el ejemplo corre dentro de un
  paquete, poné el `cd` en el mismo bloque:

  ```bash
  cd apps/web
  pnpm build
  ```

- **Los placeholders van entre ángulos.** `<tenantId>`, `<backup_file>`: el runner los sustituye
  antes de parsear el shell.

- **Los imports tienen que existir.** Si el ejemplo importa `auditConnector` de
  `@ftth-copilot/soc`, ese símbolo tiene que seguir exportándose. Si lo renombrás en el código,
  el ejemplo se actualiza en el mismo commit.

- **Las variables de entorno tienen que existir.** Si la app declara el prefijo `METRICS_`, la
  variable `METRICS_POLLER_ENABLED` tiene que estar en `.env.example`. Las variables de servicios
  externos (las de NextAuth, las de Postgres en Docker) no están: el runner las reporta como
  aviso, no como error.

## Qué NO verifica

- El **contenido** de un ejemplo: que el comando sea el correcto para la tarea, no solo que exista.
- Los ejemplos que dependen de un servicio externo: se validan, no se ejecutan.
- Los bloques sin etiqueta de lenguaje o etiquetados como `text`: son prosa, no código.
## Cuando falla

```bash
mise run docs-test
```

Cada error dice archivo, línea y qué se esperaba:

```text
ERROR docs/how-to/agregar-un-endpoint-de-la-api.md:61 — `@ftth-copilot/soc` no exporta "auditConnector" (la documentación está desfasada)
```

Se corrige la documentación (o el código, si el ejemplo tenía razón) y el CI vuelve a verde.

## Tests de la herramienta

La lógica del runner tiene sus propios tests, y corren sin dependencias externas:

```bash
node --test scripts/tests/*.test.ts
```
