import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * El entrypoint de VictoriaMetrics se ejecuta dentro del contenedor, sin
 * red y sin servidor. Lo que decide —qué ficheros de scrape se le pasan y
 * qué se renderiza en cada uno— sí se puede comprobar acá con un binario
 * de mentira que solo imprime sus argumentos.
 *
 * La decisión que importa: el scrape del worker es un SEGUNDO
 * `-promscrape.config`, y solo se pasa cuando hay un worker desplegado. Un
 * despliegue sin worker no puede mostrar un target caído para siempre.
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
      VM_SCRAPE_RENDERED: join(dir, "app.yml"),
      VM_WORKER_SCRAPE_RENDERED: join(dir, "worker.yml"),
      VICTORIAMETRICS_SCRAPE_TARGET: "app:3001",
      ...env,
    },
  })
    .split("\n")
    .filter((line) => line.length > 0);

  return { args, dir };
}

/** El cuerpo del YAML, sin los comentarios. */
function bodyOf(rendered: string): string {
  return rendered
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

test("sin worker desplegado solo se le pasa un fichero de scrape", () => {
  const { args, dir } = runEntrypoint({});
  try {
    const configs = args.filter((arg) => arg.startsWith("-promscrape.config="));
    assert.equal(configs.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("con worker desplegado se le pasan dos ficheros de scrape", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
  });
  try {
    const configs = args.filter((arg) => arg.startsWith("-promscrape.config="));
    assert.equal(configs.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el scrape del worker apunta al target configurado", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
  });
  try {
    const workerConfig = args.find(
      (arg) => arg.startsWith("-promscrape.config=") && arg.includes("worker"),
    );
    assert.ok(workerConfig, "el segundo fichero de scrape es el del worker");

    const rendered = readFileSync(workerConfig.split("=")[1]!, "utf8");
    assert.match(bodyOf(rendered), /- "host\.docker\.internal:8081"/);
    assert.doesNotMatch(bodyOf(rendered), /__WORKER_SCRAPE_TARGET__/);
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
    const workerConfig = args.find(
      (arg) => arg.startsWith("-promscrape.config=") && arg.includes("worker"),
    );
    const rendered = readFileSync(workerConfig.split("=")[1]!, "utf8");

    // El comentario nombra los placeholders. Si se sustituyeran, el fichero
    // renderizado documentaría otra cosa de la que hace.
    assert.match(rendered, /__WORKER_SCRAPE_TARGET__/);
    assert.match(rendered, /__METRICS_BEARER_TOKEN__/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el token Bearer se renderiza en los dos ficheros", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
    METRICS_BEARER_TOKEN: "shared-secret",
  });
  try {
    for (const arg of args.filter((a) => a.startsWith("-promscrape.config="))) {
      const rendered = bodyOf(readFileSync(arg.split("=")[1]!, "utf8"));
      assert.match(rendered, /credentials: "shared-secret"/);
      assert.doesNotMatch(rendered, /__METRICS_BEARER_TOKEN__/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sin token el scrape queda sin credencial", () => {
  const { args, dir } = runEntrypoint({});
  try {
    const config = args.find((arg) => arg.startsWith("-promscrape.config="));
    const rendered = readFileSync(config!.split("=")[1]!, "utf8");
    assert.match(rendered, /credentials: ""/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el entorno de despliegue se renderiza en el scrape del worker", () => {
  const { args, dir } = runEntrypoint({
    VICTORIAMETRICS_WORKER_SCRAPE_TARGET: "host.docker.internal:8081",
    DEPLOY_ENV: "staging",
  });
  try {
    const workerConfig = args.find(
      (arg) => arg.startsWith("-promscrape.config=") && arg.includes("worker"),
    );
    const rendered = readFileSync(workerConfig!.split("=")[1]!, "utf8");
    assert.match(rendered, /env: "staging"/);
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
        VM_SCRAPE_RENDERED: join(dir, "app.yml"),
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
