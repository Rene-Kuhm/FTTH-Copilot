import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  checkSupplyChain,
  findCallerPermissionViolations,
  findJobsWithoutPermissions,
  findReleaseTokenDispatchViolations,
  findReleaseTokenHeaderViolations,
  findReleaseWiringViolations,
  findUnpinnedActions,
  findUnpinnedCompositeActions,
  findAttachTagViolations,
  findReleaseNotesViolations,
  findWindowsShellViolations,
  isPinnedToSha,
  parseWorkflow,
  remoteActionRef,
  type WorkflowFile,
  type WorkflowModel,
} from "../lib/supply-chain.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function model(content: string, workflowPath = ".github/workflows/ejemplo.yml"): WorkflowModel {
  const parsed = parseWorkflow({ path: workflowPath, content });
  assert.notEqual(parsed, null, "el workflow de ejemplo tiene que parsear");
  return parsed as WorkflowModel;
}

test("remoteActionRef ignora los workflows reutilizables del repo y las imágenes docker", () => {
  assert.equal(remoteActionRef("./.github/workflows/build.yml"), null);
  assert.equal(remoteActionRef("docker://alpine:3.20"), null);
  assert.equal(
    remoteActionRef("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"),
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
});

test("isPinnedToSha acepta sólo SHAs de 40 caracteres", () => {
  assert.equal(isPinnedToSha("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"), true);
  assert.equal(isPinnedToSha("actions/checkout@v7.0.1"), false);
  assert.equal(isPinnedToSha("dtolnay/rust-toolchain@stable"), false);
  assert.equal(isPinnedToSha("actions/checkout"), false);
  assert.equal(isPinnedToSha("actions/checkout@3d3c42e"), false);
});

test("parseWorkflow extrae las acciones con su línea y los jobs con sus permisos", () => {
  const parsed = model(
    [
      "name: Ejemplo",
      "on:",
      "  push:",
      "    tags:",
      "      - 'v*'",
      "  workflow_dispatch:",
      "jobs:",
      "  build:",
      "    permissions:",
      "      contents: read",
      "    steps:",
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "      - uses: ./.github/workflows/otro.yml",
    ].join("\n"),
  );

  assert.equal(parsed.actions.length, 2);
  assert.equal(parsed.actions[0]?.ref, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  assert.equal(parsed.actions[0]?.line, 12);
  assert.deepEqual(parsed.reusableCalls, [".github/workflows/otro.yml"]);
  assert.deepEqual(parsed.tagPushTriggers, ["v*"]);
  assert.equal(parsed.hasWorkflowDispatch, true);
  assert.equal(parsed.jobs.length, 1);
  assert.deepEqual(parsed.jobs[0]?.permissions, { contents: "read" });
});

test("findUnpinnedActions reporta la acción que se usa por tag", () => {
  const parsed = model(
    [
      "jobs:",
      "  build:",
      "    permissions:",
      "      contents: read",
      "    steps:",
      "      - uses: actions/checkout@v7.0.1",
    ].join("\n"),
  );

  const violations = findUnpinnedActions(parsed);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "sha-pinning");
  assert.equal(violations[0]?.line, 6);
});

test("findUnpinnedActions no se queja de los workflows reutilizables del repo", () => {
  const parsed = model(
    [
      "jobs:",
      "  build:",
      "    permissions:",
      "      contents: read",
      "    steps:",
      "      - uses: ./.github/workflows/build.yml",
    ].join("\n"),
  );

  assert.deepEqual(findUnpinnedActions(parsed), []);
});

test("findJobsWithoutPermissions exige un bloque permissions en cada job", () => {
  const parsed = model(
    [
      "jobs:",
      "  sin-permisos:",
      "    steps:",
      "      - run: echo hola",
      "  con-permisos:",
      "    permissions:",
      "      contents: read",
      "    steps:",
      "      - run: echo hola",
    ].join("\n"),
  );

  const violations = findJobsWithoutPermissions(parsed);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "job-permissions");
  assert.match(violations[0]?.message ?? "", /sin-permisos/);
});

test("findJobsWithoutPermissions rechaza write-all y un bloque vacío", () => {
  const parsed = model(
    [
      "jobs:",
      "  write-all:",
      "    permissions: write-all",
      "    steps:",
      "      - run: echo hola",
      "  vacio:",
      "    permissions: {}",
      "    steps:",
      "      - run: echo hola",
    ].join("\n"),
  );

  const violations = findJobsWithoutPermissions(parsed);
  assert.equal(violations.length, 2);
});

// ──────────────────────────────────────────────────────────────────────
// Regla 4: el techo de permisos del caller.
//
// GitHub valida el grafo del run ANTES de crear ningún job: si un workflow
// reutilizable declara un permiso que su caller no concede, el run entero
// muere con `startup_failure` y cero jobs (sin logs: la única evidencia es
// la anotación "Invalid workflow file" en la UI).
//
// El `if:` del job no protege: la validación mira el bloque `permissions:`
// declarado, no si el job llega a correr.
//
// Contexto: `build-android.yml` y `build-desktop.yml` piden `id-token: write`
// y `attestations: write` para atestar, y `contents: write` para adjuntar
// los artefactos a la release. Los callers de validación concedían sólo
// `contents: read` → `startup_failure` en todos los PRs desde el 27-oct.
// ──────────────────────────────────────────────────────────────────────

const CALLER = [
  "name: Caller",
  "on:",
  "  pull_request:",
  "jobs:",
  "  build:",
  "    uses: ./.github/workflows/builder.yml",
  "    permissions:",
  "      contents: read",
];

const BUILDER_WITH_ELEVATED_PERMISSIONS = [
  "name: Builder",
  "on:",
  "  workflow_call:",
  "jobs:",
  "  build:",
  "    permissions:",
  "      contents: read",
  "      id-token: write",
  "    steps:",
  "      - run: echo hola",
];

test("findCallerPermissionViolations exige que el caller conceda lo que pide el builder", () => {
  const models = [
    model(CALLER.join("\n"), ".github/workflows/caller.yml"),
    model(BUILDER_WITH_ELEVATED_PERMISSIONS.join("\n"), ".github/workflows/builder.yml"),
  ];

  const violations = findCallerPermissionViolations(models);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "caller-permissions");
  assert.match(violations[0]?.message ?? "", /id-token/);
  assert.match(violations[0]?.message ?? "", /builder\.yml/);
});

test("findCallerPermissionViolations acepta un caller que concede todo lo que pide el builder", () => {
  const caller = CALLER.map((line) =>
    line === "      contents: read"
      ? "      contents: read\n      id-token: write"
      : line,
  );
  const models = [
    model(caller.join("\n"), ".github/workflows/caller.yml"),
    model(BUILDER_WITH_ELEVATED_PERMISSIONS.join("\n"), ".github/workflows/builder.yml"),
  ];

  assert.deepEqual(findCallerPermissionViolations(models), []);
});

test("findCallerPermissionViolations no se queja de los callers sin workflow reutilizable", () => {
  const standalone = [
    "name: Solo",
    "on:",
    "  pull_request:",
    "jobs:",
    "  build:",
    "    permissions:",
    "      contents: read",
    "    steps:",
    "      - run: echo hola",
  ];

  assert.deepEqual(
    findCallerPermissionViolations([model(standalone.join("\n"), ".github/workflows/solo.yml")]),
    [],
  );
});

const PUBLISHER = [
  "name: Release",
  "on:",
  "  push:",
  "    branches:",
  "      - main",
  "jobs:",
  "  release:",
  "    permissions:",
  "      contents: write",
  "    steps:",
  "      - uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071",
  "        with:",
  "          token: ${{ secrets.GITHUB_TOKEN }}",
];

const BUILDER = [
  "name: Release build",
  "on:",
  "  push:",
  "    tags:",
  "      - 'v*'",
  "  workflow_dispatch:",
  "jobs:",
  "  desktop:",
  "    permissions:",
  "      contents: read",
  "    steps:",
  "      - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8",
];

test("findReleaseWiringViolations exige que el publicador despache al builder", () => {
  const models = [
    model(PUBLISHER.join("\n"), ".github/workflows/release-please.yml"),
    model(BUILDER.join("\n"), ".github/workflows/release.yml"),
  ];

  const violations = findReleaseWiringViolations(models);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "release-wiring");
  assert.match(violations[0]?.message ?? "", /no despacha a "release.yml"/);
});

test("findReleaseWiringViolations acepta el publicador que despacha al builder", () => {
  const publisher = [
    ...PUBLISHER,
    "      - name: Dispatch the release build",
    "        run: gh api --method POST repos/${{ github.repository }}/actions/workflows/release.yml/dispatches",
  ].join("\n");

  const models = [
    model(publisher, ".github/workflows/release-please.yml"),
    model(BUILDER.join("\n"), ".github/workflows/release.yml"),
  ];

  assert.deepEqual(findReleaseWiringViolations(models), []);
});

test("findReleaseWiringViolations exige workflow_dispatch en el builder", () => {
  const builderWithoutDispatch = BUILDER.filter((line) => line !== "  workflow_dispatch:").join("\n");
  const publisher = [
    ...PUBLISHER,
    "      - name: Dispatch the release build",
    "        run: gh api --method POST repos/${{ github.repository }}/actions/workflows/release.yml/dispatches",
  ].join("\n");

  const models = [
    model(publisher, ".github/workflows/release-please.yml"),
    model(builderWithoutDispatch, ".github/workflows/release.yml"),
  ];

  const violations = findReleaseWiringViolations(models);
  assert.equal(violations.length, 1);
  assert.match(violations[0]?.message ?? "", /workflow_dispatch/);
});

// ──────────────────────────────────────────────────────────────────────
// Regla 5: coherencia entre el token de release y el dispatch del builder.
//
// El `GITHUB_TOKEN` no dispara workflows por los eventos que produce (la
// anti-recursión), así que hoy el publicador tiene que despachar al builder a
// mano cuando crea el tag. Un token propio (un PAT) sí dispara workflows: el
// `push: tags` del builder llega solo y el dispatch explícito lo duplicaría
// (dos builds y dos atestaciones del mismo tag).
//
// La regla exige que, cuando el publicador usa un token propio, el dispatch
// se condicione a que ese token NO esté presente.
// ──────────────────────────────────────────────────────────────────────

const PUBLISHER_WITH_OWN_TOKEN = [
  "name: Release",
  "on:",
  "  push:",
  "    branches:",
  "      - main",
  "jobs:",
  "  release:",
  "    permissions:",
  "      contents: write",
  "    env:",
  "      RELEASE_PLEASE_TOKEN: ${{ secrets.RELEASE_PLEASE_TOKEN }}",
  "    steps:",
  "      - uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071",
  "        with:",
  "          token: ${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}",
  "      - name: Dispatch the release build",
  "        run: gh api --method POST repos/${{ github.repository }}/actions/workflows/release.yml/dispatches",
];

const DISPATCH_LINE =
  "        run: gh api --method POST repos/${{ github.repository }}/actions/workflows/release.yml/dispatches";

test("findReleaseTokenDispatchViolations exige condicionar el dispatch con un token propio", () => {
  const models = [
    model(PUBLISHER_WITH_OWN_TOKEN.join("\n"), ".github/workflows/release-please.yml"),
    model(BUILDER.join("\n"), ".github/workflows/release.yml"),
  ];

  const violations = findReleaseTokenDispatchViolations(models);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "release-token-dispatch");
  assert.match(violations[0]?.message ?? "", /RELEASE_PLEASE_TOKEN/);
});

test("findReleaseTokenDispatchViolations acepta el dispatch condicionado al token propio", () => {
  const publisher = PUBLISHER_WITH_OWN_TOKEN.map((line) =>
    line === DISPATCH_LINE
      ? "        if: steps.release.outputs.release_created == 'true' && env.RELEASE_PLEASE_TOKEN == ''\n" + line
      : line,
  ).join("\n");

  const models = [
    model(publisher, ".github/workflows/release-please.yml"),
    model(BUILDER.join("\n"), ".github/workflows/release.yml"),
  ];

  assert.deepEqual(findReleaseTokenDispatchViolations(models), []);
});

test("findReleaseTokenDispatchViolations no se queja del publisher keyless", () => {
  const publisher = [
    ...PUBLISHER,
    "      - name: Dispatch the release build",
    DISPATCH_LINE,
  ].join("\n");

  const models = [
    model(publisher, ".github/workflows/release-please.yml"),
    model(BUILDER.join("\n"), ".github/workflows/release.yml"),
  ];

  assert.deepEqual(findReleaseTokenDispatchViolations(models), []);
});

test("los workflows del repo cumplen la política de supply chain", () => {
  const directory = path.join(REPO_ROOT, ".github", "workflows");
  const files: WorkflowFile[] = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => ({
      path: `.github/workflows/${name}`,
      content: fs.readFileSync(path.join(directory, name), "utf8"),
    }));

  assert.ok(files.length > 0, "el repo tiene workflows");

  const violations = checkSupplyChain(files);
  assert.deepEqual(
    violations.map((violation) => `${violation.path}: ${violation.message}`),
    [],
  );
});

// ──────────────────────────────────────────────────────────────────────
// Las acciones compuestas (`.github/actions/<nombre>/action.yml`)
// referencian acciones de terceros igual que un workflow: la regla de SHA
// pinning les aplica igual. Sin esto, una acción compuesta sería un hueco.
// ──────────────────────────────────────────────────────────────────────

test("findUnpinnedCompositeActions exige SHA en las acciones de una acción compuesta", () => {
  const composite = {
    path: ".github/actions/ejemplo/action.yml",
    content: [
      "name: Ejemplo",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - uses: actions/checkout@v7",
    ].join("\n"),
  };

  const violations = findUnpinnedCompositeActions([composite]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "sha-pinning");
  assert.match(violations[0]?.message ?? "", /actions\/checkout@v7/);
});

test("findUnpinnedCompositeActions acepta una acción compuesta con todo fijado por SHA", () => {
  const composite = {
    path: ".github/actions/ejemplo/action.yml",
    content: [
      "name: Ejemplo",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    ].join("\n"),
  };

  assert.deepEqual(findUnpinnedCompositeActions([composite]), []);
});

test("las acciones compuestas del repo cumplen la política de supply chain", () => {
  const directory = path.join(REPO_ROOT, ".github", "actions");
  const files: WorkflowFile[] = fs.existsSync(directory)
    ? fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          const actionDir = path.join(directory, entry.name);
          return ["action.yml", "action.yaml"]
            .map((name) => path.join(actionDir, name))
            .filter((file) => fs.existsSync(file))
            .map((file) => ({
              path: `.github/actions/${entry.name}/${path.basename(file)}`,
              content: fs.readFileSync(file, "utf8"),
            }));
        })
    : [];

  assert.deepEqual(
    findUnpinnedCompositeActions(files).map(
      (violation) => `${violation.path}: ${violation.message}`,
    ),
    [],
  );
});

// ──────────────────────────────────────────────────────────────────────
// Regla 6: el push con token propio no puede arrastrar el token del
// checkout.
//
// `actions/checkout` persiste el `GITHUB_TOKEN` del job en
// `http.https://github.com/.extraheader`. Git manda **un encabezado por cada
// valor** de esa clave, y el valor de la línea de comandos no pisa al local:
// los dos conviven. Un push con token propio que no resetee la lista empuja
// con la credencial equivocada (o manda dos encabezados de autorización y
// GitHub lo rechaza).
//
// El valor vacío resetea la lista: es lo que documenta `git config` para este
// caso. Verificado contra un servidor HTTP local: con el reset llega un solo
// encabezado (el del token propio); sin él, llega el del checkout.
//
// La regla exige el reset en el push que manda el token propio.
// ──────────────────────────────────────────────────────────────────────

const PUBLISHER_WITH_TOKEN_PUSH = [
  "name: Release",
  "on:",
  "  push:",
  "    branches:",
  "      - main",
  "jobs:",
  "  release:",
  "    permissions:",
  "      contents: write",
  "    env:",
  "      RELEASE_PLEASE_TOKEN: ${{ secrets.RELEASE_PLEASE_TOKEN }}",
  "    steps:",
  "      - uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071",
  "        with:",
  "          token: ${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}",
  "      - name: Push the synchronized version carriers",
  "        run: |",
  "          git -c \"http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}\" \\",
  "              push origin \"HEAD:${branch}\"",
];

const PUBLISHER_WITH_TOKEN_PUSH_RESET = [
  "name: Release",
  "on:",
  "  push:",
  "    branches:",
  "      - main",
  "jobs:",
  "  release:",
  "    permissions:",
  "      contents: write",
  "    env:",
  "      RELEASE_PLEASE_TOKEN: ${{ secrets.RELEASE_PLEASE_TOKEN }}",
  "    steps:",
  "      - uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071",
  "        with:",
  "          token: ${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}",
  "      - name: Push the synchronized version carriers",
  "        run: |",
  "          git -c \"http.https://github.com/.extraheader=\" \\",
  "              -c \"http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}\" \\",
  "              push origin \"HEAD:${branch}\"",
];

test("findReleaseTokenHeaderViolations exige resetear la lista de encabezados del push", () => {
  const models = [
    model(PUBLISHER_WITH_TOKEN_PUSH.join("\n"), ".github/workflows/release-please.yml"),
  ];

  const violations = findReleaseTokenHeaderViolations(models);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "release-token-headers");
  assert.match(violations[0]?.message ?? "", /extraheader/);
});

test("findReleaseTokenHeaderViolations acepta el push que resetea la lista", () => {
  const models = [
    model(PUBLISHER_WITH_TOKEN_PUSH_RESET.join("\n"), ".github/workflows/release-please.yml"),
  ];

  assert.deepEqual(findReleaseTokenHeaderViolations(models), []);
});

test("findReleaseTokenHeaderViolations no se queja del push sin token propio", () => {
  const publisher = [
    "name: Release",
    "on:",
    "  push:",
    "    branches:",
    "      - main",
    "jobs:",
    "  release:",
    "    permissions:",
    "      contents: write",
    "    steps:",
    "      - uses: googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071",
    "        with:",
    "          token: ${{ secrets.GITHUB_TOKEN }}",
    "      - name: Push the synchronized version carriers",
    "        run: |",
    "          git push origin \"HEAD:${branch}\"",
  ];

  const models = [
    model(publisher.join("\n"), ".github/workflows/release-please.yml"),
  ];

  assert.deepEqual(findReleaseTokenHeaderViolations(models), []);
});

// ──────────────────────────────────────────────────────────────────────
// Regla 7: shell explícito en runners Windows.
//
// En Windows el `run:` sin `shell:` corre en pwsh. El step bash que
// normalizaba el SBOM murió con ParserError y la v0.4.0 se publicó sin
// ningún instalador de escritorio.
// ──────────────────────────────────────────────────────────────────────

function windowsJob(extra: string[] = [], stepExtra: string[] = []): string {
  return [
    "name: W",
    "on:",
    "  workflow_dispatch:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  build-windows:",
    "    runs-on: windows-latest",
    "    permissions:",
    "      contents: read",
    ...extra,
    "    steps:",
    "      - name: Checkout",
    "        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "      - name: Normalize",
    "        run: |",
    "          set -euo pipefail",
    "          jq -S . sbom.json > out.json",
    ...stepExtra,
  ].join("\n");
}

test("findWindowsShellViolations marca un run: sin shell en Windows, con su línea", () => {
  const violations = findWindowsShellViolations(model(windowsJob()));
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "windows-shell");
  assert.equal(violations[0]?.line, 14);
  assert.match(violations[0]?.message ?? "", /Normalize/);
  assert.match(violations[0]?.message ?? "", /pwsh/);
});

test("findWindowsShellViolations acepta shell en el step", () => {
  const content = windowsJob([], ["        shell: bash"]);
  assert.deepEqual(findWindowsShellViolations(model(content)), []);
});

test("findWindowsShellViolations acepta defaults.run.shell del job o del workflow", () => {
  const jobDefaults = windowsJob(["    defaults:", "      run:", "        shell: bash"]);
  assert.deepEqual(findWindowsShellViolations(model(jobDefaults)), []);

  const workflowDefaults = windowsJob().replace(
    "jobs:",
    ["defaults:", "  run:", "    shell: bash", "jobs:"].join("\n"),
  );
  assert.deepEqual(findWindowsShellViolations(model(workflowDefaults)), []);
});

test("findWindowsShellViolations no mira runners Linux", () => {
  const linux = windowsJob().replace("windows-latest", "ubuntu-22.04");
  assert.deepEqual(findWindowsShellViolations(model(linux)), []);
});

// ──────────────────────────────────────────────────────────────────────────────
// Regla 8: el attach declara a qué tag adjunta los binarios.
//
// Los binarios se suben con `gh release upload`, que toma el tag como
// argumento. Sin el tag explícito el paso no sabe a qué release subirlos, y en
// un `workflow_dispatch` —que es como se relanza una release ya publicada— el
// `github.ref` es la rama y no el tag.
//
// Así se perdió la v0.4.0: el build de Windows era el primer fallo, pero
// detrás de él venía el attach, que no sabía a qué tag adjuntar.
// ──────────────────────────────────────────────────────────────────────────────

function workflowOf(steps: readonly string[]): string {
  return [
    "name: Release",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      tag:",
    "        required: true",
    "        type: string",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  attach:",
    "    permissions:",
    "      contents: write",
    "    steps:",
    ...steps,
  ].join("\n");
}

/**
 * @param tag Valor de `TAG` en el env del step, o `null` si no lo declara.
 */
function uploadWorkflow(tag: string | null): string {
  return workflowOf([
    "      - name: Attach the binaries to the release",
    "        env:",
    "          GH_TOKEN: ${{ github.token }}",
    ...(tag === null ? [] : [`          TAG: ${tag}`]),
    "        run: |",
    "          set -euo pipefail",
    '          gh release upload "${TAG}" "${binaries[@]}" --clobber --repo "${GITHUB_REPOSITORY}"',
  ]);
}

test("findAttachTagViolations acepta el attach que declara el tag del input", () => {
  assert.deepEqual(
    findAttachTagViolations(model(uploadWorkflow("${{ inputs.release-tag }}"))),
    [],
  );
});

test("findAttachTagViolations marca el attach con el tag fijo", () => {
  const violations = findAttachTagViolations(model(uploadWorkflow("v0.4.0")));

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "attach-tag");
  assert.match(violations[0]?.message ?? "", /tag/);
});

test("findAttachTagViolations marca el attach sin tag", () => {
  const violations = findAttachTagViolations(model(uploadWorkflow(null)));

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "attach-tag");
  assert.match(violations[0]?.message ?? "", /tag/);
});

// ──────────────────────────────────────────────────────────────────────────────
// Regla 9: el attach no reescribe el cuerpo de la release.
//
// `softprops/action-gh-release` actualiza la release antes de subir los
// binarios: eso reescribe el changelog que release-please ya había escrito y,
// con `generate_release_notes`, le suma encima las notas de GitHub. La v0.3.0
// tiene hoy esas notas repetidas cuatro veces.
//
// Los assets se suben sin tocar el cuerpo: `gh release upload` sólo sube
// archivos.
// ──────────────────────────────────────────────────────────────────────────────

test("findReleaseNotesViolations marca el step que usa softprops", () => {
  const violations = findReleaseNotesViolations(
    model(
      workflowOf([
        "      - name: Attach binaries to release",
        "        uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64 # v3.0.3",
        "        with:",
        "          files: artifacts/**/*",
      ]),
    ),
  );

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "release-notes");
  assert.match(violations[0]?.message ?? "", /gh release upload/);
});

test("findReleaseNotesViolations marca el step que reescribe la release con la CLI", () => {
  const violations = findReleaseNotesViolations(
    model(
      workflowOf([
        "      - name: Rewrite the release notes",
        "        run: gh release edit v0.4.0 --notes-file notas.md",
      ]),
    ),
  );

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "release-notes");
  assert.match(violations[0]?.message ?? "", /cuerpo/);
});

test("findReleaseNotesViolations acepta el attach que sólo sube los binarios", () => {
  assert.deepEqual(
    findReleaseNotesViolations(model(uploadWorkflow("${{ inputs.release-tag }}"))),
    [],
  );
});
