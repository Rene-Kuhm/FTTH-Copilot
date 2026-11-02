import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * El entrypoint de VictoriaMetrics se ejecuta dentro del contenedor, sin
 * red y sin servidor. Lo que decide —qué jobs de scrape le pasa y qué se
 * renderiza en cada uno— sí se puede comprobar acá con un binario de
 * mentira que solo imprime sus argumentos.
 *
 * La decisión que importa: el binario single-node de VictoriaMetrics lee UN
 * solo `-promscrape.config` (la última bandera gana), así que el job del
 * worker tiene que terminar en el mismo fichero que el de la web. Y solo
 * cuando hay un worker desplegado: un despliegue sin worker no puede
 * mostrar un target caído para siempre.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const ENTRYPOINT = join(REPO_ROOT, "docker", "victoriametrics-entrypoint.sh");
const APP_TEMPLATE = join(REPO_ROOT, "docker", "victoriametrics-scrape.yml");
const WORKER_TEMPLATE = join(REPO_ROOT, "docker", "victoriametrics-scrape-worker.yml");

/** Corre el entrypoint con un binario de mentira y devuelve lo que imprime. */
function runEntrypoint(env: Record<string, string>): { args: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vm-entrypoint-"));
  const binary = join(dir, "vm-stub");
  writeFileSync(binary, '#!/bin/sh\nfor arg in "$@"; do echo "$arg"; done\n');
  chmodSync(binary, 0o755);

  const args = execFileSync("sh", [ENTRYPOINT], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      VM_BINARY: binary,
      VM_SCRAPE_TEMPLATE: APP_TEMPLATE,
      VM_WORKER_SCRAPE_TEMPLATE: WORKER_TEMPLATE,
      VM_SCRAPE_RENDERED: join(dir, "scrape.yml"),
      VICTORIAMETRICS_SCRAPE_TARGET: "app:3001",
      ...env,
    },
  })
    .split("\n")
    .filter((line) => line.length > 0);

  return { args, dir };
}

/** El fichero de scrape renderizado, ya parseado. */
function renderedConfig(args: string[]): {
  jobs: { job_name: string; targets: string[] }[];
} {
  const config = args.find((arg) => arg.startsWith("-promscrape.config="));
  assert.ok(config, "el entrypoint pasa un fichero de scrape");
  const content = readFileSync(config.split("=")[1]!, "utf8");
  const document = parse(content) as {
    scrape_configs?: { job_name: string; static_configs?: { targets: string[] }[] }[];
  };
  return {
    jobs: (document.scrape_configs ?? []).map((job) => ({
      job_name: job.job_name,
      targets: (job.static_configs ?? []).flatMap((entry) => entry.targets ?? []),
    })),
  };
}

/** El cuerpo del YAML, sin los comentarios. */
function bodyOf(rendered: string): string {
  return rendered
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

test("se le pasa un solo fichero de scrape", () => {
  const { args, dir } = runEntrypoint({});
  try {
    const configs = args.filter((arg) => arg.startsWith("-promscrape.config="));
    assert.equal(configs.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sin worker desplegado solo se scrapea la web", () => {
  const { args, dir } = runEntrypoint({});
  try {
    const { jobs } = renderedConfig(args);

    assert.deepEqual(
      jobs.map((job) => job.job_name),
      ["ftth-copilot-app"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("con worker desplegado los dos jobs van en el mismo fichero", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
  });
  try {
    const { jobs } = renderedConfig(args);

    assert.deepEqual(
      jobs.map((job) => job.job_name),
      ["ftth-copilot-app", "ftth-copilot-worker"],
    );
    assert.deepEqual(jobs[1]?.targets, ["host.docker.internal:8081"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el scrape del worker apunta al target configurado", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
  });
  try {
    const config = args.find((arg) => arg.startsWith("-promscrape.config="));
    const rendered = readFileSync(config!.split("=")[1]!, "utf8");

    assert.match(bodyOf(rendered), /- "host\.docker\.internal:8081"/);
    assert.doesNotMatch(bodyOf(rendered), /__WORKER_SCRAPE_TARGET__/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el token Bearer se renderiza en los dos jobs", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
    METRICS_BEARER_TOKEN: "shared-secret",
  });
  try {
    const config = args.find((arg) => arg.startsWith("-promscrape.config="));
    const rendered = readFileSync(config!.split("=")[1]!, "utf8");

    assert.equal(bodyOf(rendered).match(/credentials: "shared-secret"/g)?.length, 2);
    assert.doesNotMatch(bodyOf(rendered), /__METRICS_BEARER_TOKEN__/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sin token el scrape queda sin credencial", () => {
  const { args, dir } = runEntrypoint({});
  try {
    const config = args.find((arg) => arg.startsWith("-promscrape.config="));
    const rendered = readFileSync(config!.split("=")[1]!, "utf8");

    assert.match(bodyOf(rendered), /credentials: ""/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el entorno de despliegue se renderiza en los dos jobs", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
    DEPLOY_ENV: "staging",
  });
  try {
    const config = args.find((arg) => arg.startsWith("-promscrape.config="));
    const rendered = readFileSync(config!.split("=")[1]!, "utf8");

    assert.equal(bodyOf(rendered).match(/env: "staging"/g)?.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("los comentarios de la plantilla no se sustituyen", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
    METRICS_BEARER_TOKEN: "shared-secret",
    DEPLOY_ENV: "staging",
  });
  try {
    const config = args.find((arg) => arg.startsWith("-promscrape.config="));
    const rendered = readFileSync(config!.split("=")[1]!, "utf8");

    // El comentario nombra los placeholders. Si se sustituyeran, el fichero
    // renderizado documentaría otra cosa de la que hace.
    assert.match(rendered, /__WORKER_SCRAPE_TARGET__/);
    assert.match(rendered, /__METRICS_BEARER_TOKEN__/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("los argumentos que pasa el llamador se conservan al final", () => {
  const dir = mkdtempSync(join(tmpdir(), "vm-entrypoint-"));
  try {
    const binary = join(dir, "vm-stub");
    writeFileSync(binary, '#!/bin/sh\nfor arg in "$@"; do echo "$arg"; done\n');
    chmodSync(binary, 0o755);

    const args = execFileSync("sh", [ENTRYPOINT, "-httpListenAddr=:9999"], {
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        VM_BINARY: binary,
        VM_SCRAPE_TEMPLATE: APP_TEMPLATE,
        VM_SCRAPE_RENDERED: join(dir, "scrape.yml"),
        VICTORIAMETRICS_SCRAPE_TARGET: "app:3001",
      },
    })
      .split("\n")
      .filter((line) => line.length > 0);

    assert.ok(args.includes("-httpListenAddr=:9999"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
