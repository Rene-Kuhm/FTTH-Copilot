/**
 * Política de supply chain del repositorio, verificada contra los YAML de
 * `.github/workflows/`.
 *
 * Funciones puras sobre el contenido de los workflows: no tocan el disco ni la
 * red. Así la política se testea con `node --test` y se corre en el CI sin
 * depender de nada externo.
 *
 * Tres reglas:
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
 * Ver `docs/reference/contenedores-y-ci.md` para el detalle de cada regla.
 */
import { LineCounter, isScalar, parseDocument, visit } from "yaml";

/** Identificador de cada regla de la política. */
export type PolicyRule = "sha-pinning" | "job-permissions" | "release-wiring" | "caller-permissions";

/** Una acción referenciada por un `uses:`. */
export interface ActionReference {
  /** Valor crudo del `uses:` (por ejemplo `actions/checkout@<sha>`). */
  readonly ref: string;
  /** Línea (1-based) donde aparece el `uses:`. */
  readonly line: number;
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
 * Corre las tres reglas sobre un conjunto de workflows.
 *
 * Devuelve todas las violaciones; una lista vacía significa que el repo
 * cumple la política.
 */
export function checkSupplyChain(files: readonly WorkflowFile[]): PolicyViolation[] {
  const models = files
    .map((file) => parseWorkflow(file))
    .filter((model): model is WorkflowModel => model !== null);
  const violations: PolicyViolation[] = [];
  for (const model of models) {
    violations.push(...findUnpinnedActions(model));
    violations.push(...findJobsWithoutPermissions(model));
  }
  violations.push(...findReleaseWiringViolations(models));
  violations.push(...findCallerPermissionViolations(models));
  return violations;
}
