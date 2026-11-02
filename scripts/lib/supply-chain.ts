/**
 * Política de supply chain del repositorio, verificada contra los YAML de
 * `.github/workflows/`.
 *
 * Funciones puras sobre el contenido de los workflows: no tocan el disco ni la
 * red. Así la política se testea con `node --test` y se corre en el CI sin
 * depender de nada externo.
 *
 * Cuatro reglas:
 *
 *   1. `sha-pinning` — toda acción remota se usa fijada por SHA de commit.
 *      Un tag se puede mover (y una rama, con más razón): el SHA es lo único
 *      que no cambia bajo los pies. Los workflows reutilizables del propio repo
 *      (`./.github/workflows/...`) y las imágenes `docker://` no se fijan.
 *
 *   2. `job-permissions` — todo job declara su propio bloque `permissions:`.
 *      El permiso efectivo de un job es la intersección del bloque de
 *      nivel superior con el del job: si el job no declara nada, hereda el
 *      baseline, y "heredar" es como se filtran permisos por accidente.
 *
 *   3. `release-wiring` — el pipeline de release es alcanzable de punta a
 *      punta. release-please crea el tag con el `GITHUB_TOKEN` del repo, y
 *      GitHub no dispara workflows nuevos por los eventos que produce su
 *      propio token (la anti-recursión). Un `push: tags: v*` no alcanza para
 *      compilar y atestar los artefactos de la release: el workflow que
 *      publica la release tiene que despachar explícitamente al que construye
 *      y atesta. `workflow_dispatch` es una de las dos excepciones
 *      documentadas de esa regla, y es keyless: no hace falta un PAT ni una
 *      GitHub App.
 *
 *   4. `caller-permissions` — el caller de un workflow reutilizable concede
 *      todo lo que el workflow llamado pide, o GitHub rechaza el run entero
 *      con `startup_failure` y cero jobs.
 *
 *   5. `release-token-dispatch` — coherencia entre el token del publicador y
 *      el dispatch del builder. Con el `GITHUB_TOKEN` el dispatch explícito
 *      es obligatorio (regla 3). Con un token propio (un PAT) el `push: tags`
 *      del builder ya dispara solo, así que el dispatch tiene que quedar
 *      condicionado: si no, la release se construye y se atesta dos veces.
 *
 *   6. `release-token-headers` — el push que manda un token propio resetea
 *      la lista de encabezados HTTP. `actions/checkout` persiste el
 *      `GITHUB_TOKEN` del job en `http.<url>.extraheader`, y git manda **un
 *      encabezado por cada valor** de esa clave: sin el reset, el push
 *      empuja con la credencial del checkout en vez de con la propia.
 *
 * Ver `docs/reference/contenedores-y-ci.md` para el detalle de cada regla.
 */
import { LineCounter, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";

/** Identificador de cada regla de la política. */
export type PolicyRule =
  | "sha-pinning"
  | "job-permissions"
  | "release-wiring"
  | "caller-permissions"
  | "release-token-dispatch"
  | "release-token-headers"
  | "windows-shell";

/** Una acción referenciada por un `uses:`. */
export interface ActionReference {
  /** Valor crudo del `uses:` (por ejemplo `actions/checkout@<sha>`). */
  readonly ref: string;
  /** Línea (1-based) donde aparece el `uses:`. */
  readonly line: number;
}

/** Un step de un job, con lo que la política necesita mirar. */
export interface WorkflowStep {
  /** Nombre del step (puede estar vacío). */
  readonly name: string;
  /** Condición `if:` del step, si la tiene. */
  readonly if: string | null;
  /** Comando `run:` del step, si lo tiene. */
  readonly run: string | null;
  /** Acción que el step usa, si usa alguna. */
  readonly uses: string | null;
  /** Inputs `with:` del step. */
  readonly with: Record<string, unknown> | null;
  /** Shell `shell:` declarado por el step, si lo declara. */
  readonly shell: string | null;
  /** Línea (1-based) del step en el archivo, o `null` si no se pudo ubicar. */
  readonly line: number | null;
}

/** Un job de un workflow, con lo que declara sobre sus permisos. */
export interface WorkflowJob {
  /** Nombre del job. */
  readonly name: string;
  /**
   * Bloque `permissions:` declarado por el job.
   *
   * - `null`: el job no declara permisos.
   * - `"read-all"` / `"write-all"`: forma escalar.
   * - objeto: un permiso por scope (`{ contents: "read" }`).
   */
  readonly permissions: string | Record<string, string> | null;
  /**
   * Workflow reutilizable del repo al que este job llama, si llama a alguno.
   *
   * `null` cuando el job no es un caller (no tiene `uses:` de nivel de job).
   */
  readonly reusableCall: string | null;
  /** Variables `env:` declaradas a nivel de job. */
  readonly env: Record<string, string>;
  /** Valor de `runs-on:` del job, aplanado a texto (vacío si no tiene). */
  readonly runsOn: string;
  /** Shell de `defaults.run.shell` del job, si lo declara. */
  readonly defaultShell: string | null;
  /** Steps del job, en orden. */
  readonly steps: readonly WorkflowStep[];
}

/** Un workflow del repositorio. */
export interface WorkflowFile {
  /** Ruta relativa al repo (por ejemplo `.github/workflows/ci.yml`). */
  readonly path: string;
  /** Contenido crudo del archivo. */
  readonly content: string;
}

/** Lo que la política necesita saber de un workflow. */
export interface WorkflowModel {
  readonly path: string;
  /** Todos los `uses:` del workflow, con su línea. */
  readonly actions: readonly ActionReference[];
  readonly jobs: readonly WorkflowJob[];
  /**
   * Bloque `permissions:` de nivel de workflow.
   *
   * Es el fallback de un job que no declara su propio bloque: el permiso
   * efectivo de ese job es la intersección de los dos.
   */
  readonly workflowPermissions: string | Record<string, string> | null;
  /** Workflows reutilizables del propio repo que este workflow llama. */
  readonly reusableCalls: readonly string[];
  /**
   * Workflows que este workflow despacha.
   *
   * Se detectan las dos formas que inician un run nuevo desde un workflow:
   * la API (`POST /repos/{owner}/{repo}/actions/workflows/<file>/dispatches`)
   * y la CLI (`gh workflow run <file>`).
   */
  readonly dispatchTargets: readonly string[];
  /** Patrones de tag que disparan el workflow (`push.tags`). */
  readonly tagPushTriggers: readonly string[];
  /** Si el workflow acepta `workflow_dispatch`. */
  readonly hasWorkflowDispatch: boolean;
  /** Shell de `defaults.run.shell` del workflow, si lo declara. */
  readonly defaultShell: string | null;
}

/** Una violación de la política. */
export interface PolicyViolation {
  readonly rule: PolicyRule;
  /** Ruta del workflow donde está la violación. */
  readonly path: string;
  /** Línea (1-based) si la violación se puede localizar. */
  readonly line: number | null;
  /** Qué está mal, en una línea. */
  readonly message: string;
}

/** La acción que publica las releases del repo. */
const PUBLISHER_ACTION = "googleapis/release-please-action";

/** La acción que emite la procedencia SLSA de los artefactos. */
const ATTESTATION_ACTION = "actions/attest-build-provenance";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Devuelve el nombre del archivo de un workflow (`release.yml`). */
export function workflowName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extrae el valor de `uses:` de un `ref`.
 *
 * Devuelve `null` para los `uses:` que no son acciones remotas: los
 * workflows reutilizables del propio repo y las imágenes `docker://`.
 */
export function remoteActionRef(ref: string): string | null {
  const value = ref.trim();
  if (value.startsWith("./") || value.startsWith("docker://")) return null;
  return value;
}

/** Si el `ref` de una acción remota está fijado a un SHA de commit. */
export function isPinnedToSha(ref: string): boolean {
  const remote = remoteActionRef(ref);
  if (remote === null) return false;
  const separator = remote.lastIndexOf("@");
  if (separator === -1) return false;
  return SHA_PATTERN.test(remote.slice(separator + 1));
}

/** Normaliza el bloque `permissions:` de un job a una forma comparable. */
function normalizePermissions(value: unknown): string | Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const entries: Record<string, string> = {};
  for (const [scope, level] of Object.entries(value)) {
    entries[scope] = typeof level === "string" ? level : String(level);
  }
  return entries;
}

/**
 * Normaliza el bloque `env:` de un job a un mapa de variables.
 *
 * Sólo se guardan los valores que son escalares: los secretos llegan como
 * expresión (`${{ secrets.X }}`) y lo que la política necesita es saber qué
 * variable expone cada secret.
 */
function normalizeEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      entries[key] = raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      entries[key] = String(raw);
    }
  }
  return entries;
}

/** Normaliza los steps de un job. */
function defaultShellOf(node: Record<string, unknown>): string | null {
  const defaults = node.defaults;
  if (!isRecord(defaults)) return null;
  const run = defaults.run;
  if (!isRecord(run)) return null;
  return typeof run.shell === "string" ? run.shell : null;
}

function runsOnOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(" ");
  if (isRecord(value)) return JSON.stringify(value);
  return "";
}

function normalizeSteps(value: unknown, lines: readonly (number | null)[] = []): WorkflowStep[] {
  if (!Array.isArray(value)) return [];
  let index = -1;
  const steps: WorkflowStep[] = [];
  for (const raw of value) {
    index += 1;
    if (!isRecord(raw)) continue;
    steps.push({
      name: typeof raw.name === "string" ? raw.name : "",
      if:
        typeof raw.if === "string"
          ? raw.if
          : typeof raw.if === "boolean"
            ? String(raw.if)
            : null,
      run: typeof raw.run === "string" ? raw.run : null,
      uses: typeof raw.uses === "string" ? raw.uses : null,
      with: isRecord(raw.with) ? (raw.with as Record<string, unknown>) : null,
      shell: typeof raw.shell === "string" ? raw.shell : null,
      line: lines[index] ?? null,
    });
  }
  return steps;
}

/**
 * Parsea un workflow y extrae lo que la política necesita.
 *
 * Devuelve `null` si el YAML no se puede parsear: un workflow roto es un
 * problema del workflow, no de la política, y lo reporta GitHub con más
 * detalle que este guard.
 */
export function parseWorkflow(file: WorkflowFile): WorkflowModel | null {
  const lineCounter = new LineCounter();
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(file.content, { lineCounter });
  } catch {
    return null;
  }
  if (document.errors.length > 0) return null;

  const actions: ActionReference[] = [];
  visit(document, {
    Pair(_key, pair) {
      const key = pair.key;
      if (!isScalar(key) || key.value !== "uses") return;
      const value = pair.value;
      if (!isScalar(value)) return;
      const range = key.range;
      const line = range ? lineCounter.linePos(range[0]).line : 0;
      actions.push({ ref: String(value.value ?? ""), line });
    },
  });

  // Línea de cada step, por job, para que la violación apunte al step.
  const stepLines = new Map<string, (number | null)[]>();
  const jobsMap = document.get("jobs", true);
  if (isMap(jobsMap)) {
    for (const item of jobsMap.items) {
      if (!isScalar(item.key) || !isMap(item.value)) continue;
      const stepsSeq = item.value.get("steps", true);
      if (!isSeq(stepsSeq)) continue;
      stepLines.set(
        String(item.key.value),
        stepsSeq.items.map((node) => {
          const range = (node as { range?: [number, number, number] | null }).range;
          return range ? lineCounter.linePos(range[0]).line : null;
        }),
      );
    }
  }

  const plain = document.toJS() as Record<string, unknown>;
  const jobs: WorkflowJob[] = [];
  const jobsNode = plain.jobs;
  if (isRecord(jobsNode)) {
    for (const [name, definition] of Object.entries(jobsNode)) {
      if (!isRecord(definition)) continue;
      // Un job que llama a un workflow reutilizable lo hace con `uses:` a
      // nivel de job (no con `steps:`). Sólo esos jobs imponen un techo de
      // permisos al workflow llamado.
      const uses = definition.uses;
      const reusableCall =
        typeof uses === "string" && uses.trim().startsWith("./.github/workflows/")
          ? uses.trim().slice(2)
          : null;
      jobs.push({
        name,
        permissions: normalizePermissions(definition.permissions),
        reusableCall,
        env: normalizeEnv(definition.env),
        runsOn: runsOnOf(definition["runs-on"]),
        defaultShell: defaultShellOf(definition),
        steps: normalizeSteps(definition.steps, stepLines.get(name)),
      });
    }
  }

  const reusableCalls = actions
    .map((action) => action.ref.trim())
    .filter((ref) => ref.startsWith("./.github/workflows/"))
    .map((ref) => ref.slice(2));

  const dispatchTargets: string[] = [];
  const apiDispatch = /actions\/workflows\/([A-Za-z0-9._-]+\.ya?ml)\/dispatches/g;
  const cliDispatch = /workflow\s+run\s+([A-Za-z0-9._-]+\.ya?ml)/g;
  for (const pattern of [apiDispatch, cliDispatch]) {
    for (const match of file.content.matchAll(pattern)) {
      const target = match[1];
      if (target) dispatchTargets.push(target);
    }
  }

  const tagPushTriggers: string[] = [];
  let hasWorkflowDispatch = false;
  const triggers = plain.on;
  if (isRecord(triggers)) {
    const push = triggers.push;
    if (isRecord(push)) {
      const tags = push.tags;
      if (typeof tags === "string") tagPushTriggers.push(tags);
      else if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (typeof tag === "string") tagPushTriggers.push(tag);
        }
      }
    }
    if (triggers.workflow_dispatch !== undefined) hasWorkflowDispatch = true;
  }

  return {
    path: file.path,
    actions,
    jobs,
    workflowPermissions: normalizePermissions(plain.permissions),
    reusableCalls,
    dispatchTargets,
    tagPushTriggers,
    hasWorkflowDispatch,
    defaultShell: defaultShellOf(plain),
  };
}

/** Regla 1: toda acción remota fijada por SHA de commit. */
export function findUnpinnedActions(model: WorkflowModel): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const action of model.actions) {
    const remote = remoteActionRef(action.ref);
    if (remote === null) continue;
    if (isPinnedToSha(remote)) continue;
    violations.push({
      rule: "sha-pinning",
      path: model.path,
      line: action.line,
      message: `la acción "${remote}" no está fijada por SHA de commit (se usa "${remote}")`,
    });
  }
  return violations;
}

/** Regla 2: todo job declara su propio bloque `permissions:`. */
export function findJobsWithoutPermissions(model: WorkflowModel): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const job of model.jobs) {
    if (job.permissions === null) {
      violations.push({
        rule: "job-permissions",
        path: model.path,
        line: null,
        message: `el job "${job.name}" no declara su propio bloque permissions:`,
      });
      continue;
    }
    if (job.permissions === "write-all") {
      violations.push({
        rule: "job-permissions",
        path: model.path,
        line: null,
        message: `el job "${job.name}" pide write-all: contradice el mínimo privilegio`,
      });
      continue;
    }
    if (typeof job.permissions === "object" && Object.keys(job.permissions).length === 0) {
      violations.push({
        rule: "job-permissions",
        path: model.path,
        line: null,
        message: `el job "${job.name}" declara permissions: vacío`,
      });
    }
  }
  return violations;
}

/**
 * Los scopes que un job concede, como mapa scope → nivel.
 *
 * Un job que no declara `permissions:` hereda el bloque de nivel de workflow;
 * si tampoco hay bloque de workflow, GitHub usa el default del repo. Los
 * callers siempre declaran su bloque (regla 2), así que el caso heredado se
 * trata como "no concede nada explícito".
 */
function grantedScopes(
  permissions: string | Record<string, string> | null,
): Map<string, string> {
  const scopes = new Map<string, string>();
  if (permissions === null) return scopes;
  if (permissions === "write-all") {
    // `write-all` concede todos los scopes; se modela con un sentinel.
    scopes.set("*", "write");
    return scopes;
  }
  if (permissions === "read-all") {
    scopes.set("*", "read");
    return scopes;
  }
  for (const [scope, level] of Object.entries(permissions)) {
    scopes.set(scope, level);
  }
  return scopes;
}

/** El nivel que concede un scope, o `none` si no lo concede. */
function levelFor(scopes: Map<string, string>, scope: string): string {
  const wildcard = scopes.get("*");
  if (wildcard !== undefined) return wildcard;
  return scopes.get(scope) ?? "none";
}

/**
 * Regla 4: el caller concede todo lo que pide el workflow reutilizable.
 *
 * GitHub valida el grafo del run antes de crear ningún job. Si un workflow
 * reutilizable declara un permiso que su caller no concede, el run entero
 * muere con `startup_failure` y cero jobs: no hay logs, la única evidencia
 * es la anotación "Invalid workflow file" en la UI.
 *
 * El `if:` del job no protege: la validación mira el bloque `permissions:`
 * declarado, no si el job llega a correr. Por eso el `attach-to-release`
 * (que pide `contents: write` y sólo corre en modo release) también obliga al
 * caller a conceder `contents: write`.
 *
 * El permiso que un job del workflow llamado pide es la intersección de su
 * bloque `permissions:` con el bloque de nivel de workflow: si el job no
 * declara bloque, hereda el del workflow.
 */
export function findCallerPermissionViolations(
  models: readonly WorkflowModel[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const caller of models) {
    for (const job of caller.jobs) {
      if (job.reusableCall === null) continue;

      const builder = models.find((candidate) =>
        candidate.path.endsWith(job.reusableCall as string),
      );
      if (!builder) continue;

      // El techo que el caller concede: su bloque de job si declara uno, y
      // si no, el de nivel de workflow.
      const granted = grantedScopes(job.permissions ?? caller.workflowPermissions);

      for (const builderJob of builder.jobs) {
        const requested = grantedScopes(
          builderJob.permissions ?? builder.workflowPermissions,
        );
        for (const [scope, level] of requested) {
          if (level === "none") continue;
          const ceiling = levelFor(granted, scope);
          if (ceiling === "none" || (ceiling === "read" && level === "write")) {
            violations.push({
              rule: "caller-permissions",
              path: caller.path,
              line: null,
              message:
                `el job "${job.name}" llama a "${job.reusableCall}" pero concede ` +
                `"${scope}: ${ceiling}" y ese workflow pide "${scope}: ${level}": ` +
                `GitHub rechaza el run entero con startup_failure y cero jobs`,
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Si un workflow llega a la acción de atestación, siguiendo las llamadas a
 * workflows reutilizables del propio repo.
 */
export function reachesAttestation(
  model: WorkflowModel,
  models: readonly WorkflowModel[],
): boolean {
  const seen = new Set<string>();
  const pending = [model];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current.path)) continue;
    seen.add(current.path);
    if (
      current.actions.some(
        (action) => remoteActionRef(action.ref)?.startsWith(`${ATTESTATION_ACTION}@`) === true,
      )
    ) {
      return true;
    }
    for (const call of current.reusableCalls) {
      const called = models.find((candidate) => candidate.path.endsWith(call));
      if (called) pending.push(called);
    }
  }
  return false;
}

/**
 * Regla 3: el pipeline de release es alcanzable.
 *
 * El workflow que publica la release tiene que despachar al que compila y
 * atesta los artefactos, porque el tag lo crea el `GITHUB_TOKEN` y GitHub no
 * dispara workflows por los eventos que produce su propio token.
 */
export function findReleaseWiringViolations(
  models: readonly WorkflowModel[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const publishers = models.filter((model) =>
    model.actions.some(
      (action) => remoteActionRef(action.ref)?.startsWith(`${PUBLISHER_ACTION}@`) === true,
    ),
  );

  const releaseBuilders = models.filter(
    (model) =>
      model.tagPushTriggers.length > 0 && reachesAttestation(model, models),
  );

  if (publishers.length === 0) {
    violations.push({
      rule: "release-wiring",
      path: ".github/workflows",
      line: null,
      message: `ningún workflow publica la release (${PUBLISHER_ACTION} no está en uso)`,
    });
  }

  if (releaseBuilders.length === 0) {
    violations.push({
      rule: "release-wiring",
      path: ".github/workflows",
      line: null,
      message: `ningún workflow construye y atesta los artefactos de la release (${ATTESTATION_ACTION} no está en uso)`,
    });
  }

  for (const publisher of publishers) {
    for (const builder of releaseBuilders) {
      const name = workflowName(builder.path);
      if (!builder.hasWorkflowDispatch) {
        violations.push({
          rule: "release-wiring",
          path: builder.path,
          line: null,
          message: `el builder de release "${name}" no acepta workflow_dispatch: no se lo puede despachar`,
        });
      }
      if (!publisher.dispatchTargets.includes(name)) {
        violations.push({
          rule: "release-wiring",
          path: publisher.path,
          line: null,
          message:
            `el workflow que publica la release no despacha a "${name}": ` +
            `el tag lo crea el GITHUB_TOKEN y un push de tag hecho por el ` +
            `GITHUB_TOKEN no dispara ningún workflow`,
        });
      }
    }
  }

  return violations;
}

/**
 * Regla 1: toda acción de una acción compuesta también va fijada por SHA.
 *
 * Las acciones compuestas (`.github/actions/<nombre>/action.yml`) referencian
 * acciones de terceros igual que un workflow, así que la regla de SHA pinning
 * les aplica igual. Sin esto, una acción compuesta sería un hueco por el que
 * entra una acción sin fijar.
 */
export function findUnpinnedCompositeActions(
  files: readonly WorkflowFile[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const file of files) {
    const model = parseWorkflow(file);
    if (model === null) continue;
    violations.push(...findUnpinnedActions(model));
  }
  return violations;
}

/**
 * Regla 5: el token del publicador y el dispatch del builder son coherentes.
 *
 * Con el `GITHUB_TOKEN` el dispatch explícito es obligatorio (regla 3): el tag
 * lo crea el propio token y su evento no dispara ningún workflow.
 *
 * Con un token propio (un PAT) pasa lo contrario: el `push: tags` del builder
 * **sí** dispara, porque la anti-recursión sólo exime al `GITHUB_TOKEN`. Si el
 * dispatch queda sin condicionar, el builder corre dos veces para el mismo tag:
 * dos compilaciones, dos atestaciones y el conflicto de los assets repetidos.
 *
 * Por eso, cuando el publicador usa un token propio, el dispatch tiene que
 * quedar condicionado a que ese token **no** esté presente. La condición se
 * apoya en una variable de `env:` de job, porque los secrets no se pueden
 * referenciar en un `if:`.
 */
export function findReleaseTokenDispatchViolations(
  models: readonly WorkflowModel[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const publisher of models) {
    const secret = findOwnTokenSecret(publisher);
    if (secret === null) continue;

    const envVar = findTokenEnvVar(publisher, secret);
    for (const job of publisher.jobs) {
      for (const step of job.steps) {
        if (!dispatchesWorkflow(step)) continue;
        const condition = step.if ?? "";
        if (envVar !== null && condition.includes(`env.${envVar}`)) continue;
        violations.push({
          rule: "release-token-dispatch",
          path: publisher.path,
          line: null,
          message:
            `el publicador usa el secret "${secret}" y despacha al builder sin ` +
            `condicionarlo a que ese token esté ausente: con un token propio el ` +
            `push del tag ya dispara el builder y el dispatch lo construye por ` +
            `segunda vez (dos builds y dos atestaciones del mismo tag). ` +
            `Condicioná el step con "env.${envVar ?? "<VAR>"} == ''"`,
        });
      }
    }
  }

  return violations;
}

/**
 * El secret de token propio que usa el publicador, si usa alguno.
 *
 * Devuelve el nombre del secret cuando el `token:` del publicador menciona un
 * secret distinto de `GITHUB_TOKEN`, y `null` cuando la release va keyless.
 */
function findOwnTokenSecret(model: WorkflowModel): string | null {
  for (const job of model.jobs) {
    for (const step of job.steps) {
      if (!step.uses || !step.uses.startsWith(`${PUBLISHER_ACTION}@`)) continue;
      const token = step.with?.["token"];
      if (typeof token !== "string") continue;
      for (const match of token.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
        const name = match[1];
        if (name !== undefined && name !== "GITHUB_TOKEN") return name;
      }
    }
  }
  return null;
}

/**
 * La variable de `env:` de job que expone ese secret.
 *
 * Los secrets no se pueden referenciar en un `if:`: el `if:` tiene que mirar
 * una variable de entorno, que es lo que esta función localiza.
 */
function findTokenEnvVar(model: WorkflowModel, secret: string): string | null {
  for (const job of model.jobs) {
    for (const [name, value] of Object.entries(job.env)) {
      if (value.includes(`secrets.${secret}`)) return name;
    }
  }
  return null;
}

/** Si un step despacha a otro workflow (por API o por la CLI de `gh`). */
function dispatchesWorkflow(step: WorkflowStep): boolean {
  if (step.run === null) return false;
  return (
    /actions\/workflows\/[A-Za-z0-9._-]+\.ya?ml\/dispatches/.test(step.run) ||
    /gh\s+workflow\s+run\s+[A-Za-z0-9._-]+\.ya?ml/.test(step.run)
  );
}

/**
 * Regla 6: el push con token propio resetea la lista de encabezados.
 *
 * `actions/checkout` persiste el `GITHUB_TOKEN` del job en
 * `http.https://github.com/.extraheader`. Git manda **un encabezado por cada
 * valor** de esa clave y el valor de la línea de comandos no pisa al local:
 * los dos conviven. El valor de la línea de comandos solo gana si antes se
 * resetea la lista con el valor vacío (es lo que documenta `git config` para
 * este caso).
 *
 * Sin el reset, el push empuja con la credencial del checkout —que es el
 * `GITHUB_TOKEN` del bot— en vez de con el token propio: el push funciona,
 * pero no dispara el CI del PR de release, que es justo lo que el token
 * propio tenía que resolver.
 */
export function findReleaseTokenHeaderViolations(
  models: readonly WorkflowModel[],
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const publisher of models) {
    if (findOwnTokenSecret(publisher) === null) continue;

    for (const job of publisher.jobs) {
      for (const step of job.steps) {
        if (step.run === null) continue;
        if (!sendsOwnAuthorizationHeader(step.run)) continue;
        if (resetsExtraHeaders(step.run)) continue;
        violations.push({
          rule: "release-token-headers",
          path: publisher.path,
          line: null,
          message:
            "el push manda un encabezado de autorización propio sin resetear " +
            "la lista de extraheader: el checkout persistió el GITHUB_TOKEN en " +
            "esa clave y git manda un encabezado por cada valor, así que el push " +
            'usaría la credencial del checkout en vez de la propia. Agregá ' +
            '-c "http.https://github.com/.extraheader=" antes del que lleva el token',
        });
      }
    }
  }

  return violations;
}

/** Si un run manda un encabezado de autorización propio. */
function sendsOwnAuthorizationHeader(run: string): boolean {
  return /\.extraheader\s*=\s*"?AUTHORIZATION/i.test(run);
}

/**
 * Si un run resetea la lista de encabezados antes de mandarla.
 *
 * El reset es el valor vacío: `.extraheader="` sin nada después, al final de
 * la línea.
 */
function resetsExtraHeaders(run: string): boolean {
  return /\.extraheader\s*=\s*['"]\s*(\\)?\s*$/m.test(run);
}

/**
 * Corre las siete reglas sobre un conjunto de workflows.
 *
 * Devuelve todas las violaciones; una lista vacía significa que el repo
 * cumple la política.
 */
/**
 * Regla 7: en un runner Windows, todo `run:` declara su shell.
 *
 * En Windows el shell por defecto de un `run:` es `pwsh`, no `bash`. Un
 * script bash (`set -euo pipefail`, `$(...)`, `jq ... > archivo`) corre en
 * PowerShell y muere con `ParserError` antes de ejecutar nada. Así se cayó
 * el build de Windows de la v0.4.0, y con él el adjunto de todos los
 * instaladores de escritorio a la release.
 *
 * Se exige que el shell sea explícito, en el step o en `defaults.run.shell`
 * del job o del workflow: quien escribe el step dice qué intérprete espera.
 */
export function findWindowsShellViolations(model: WorkflowModel): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const job of model.jobs) {
    if (!/windows/i.test(job.runsOn)) continue;
    if (job.defaultShell !== null || model.defaultShell !== null) continue;
    for (const step of job.steps) {
      if (step.run === null || step.shell !== null) continue;
      violations.push({
        rule: "windows-shell",
        path: model.path,
        line: step.line,
        message:
          `el step "${step.name || "(sin nombre)"}" del job "${job.name}" corre en Windows sin ` +
          "`shell:`; ahí el shell por defecto es pwsh. Declará `shell: bash` (o `pwsh`) en el " +
          "step o en `defaults.run.shell` del job.",
      });
    }
  }
  return violations;
}

export function checkSupplyChain(files: readonly WorkflowFile[]): PolicyViolation[] {
  const models = files
    .map((file) => parseWorkflow(file))
    .filter((model): model is WorkflowModel => model !== null);
  const violations: PolicyViolation[] = [];
  for (const model of models) {
    violations.push(...findUnpinnedActions(model));
    violations.push(...findJobsWithoutPermissions(model));
    violations.push(...findWindowsShellViolations(model));
  }
  violations.push(...findReleaseWiringViolations(models));
  violations.push(...findCallerPermissionViolations(models));
  violations.push(...findReleaseTokenDispatchViolations(models));
  violations.push(...findReleaseTokenHeaderViolations(models));
  return violations;
}
