import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  checkSupplyChain,
  findCallerPermissionViolations,
  findJobsWithoutPermissions,
  findReleaseWiringViolations,
  findUnpinnedActions,
  findUnpinnedCompositeActions,
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
