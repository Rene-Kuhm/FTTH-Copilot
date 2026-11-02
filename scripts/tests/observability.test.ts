import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractMetricNames,
  findRulesUsingMetric,
  findUnexportedMetrics,
  parseAlertRules,
  parseExportedMetrics,
} from "../lib/observability.ts";

/**
 * El contrato entre las alertas y las métricas exportadas es invisible en
 * una revisión: una alerta sobre una métrica que nadie expone queda
 * INACTIVE y no se nota. Estos tests lo cierran sobre los ficheros reales
 * del repo.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..");

test("extrae los nombres de métrica de una expresión", () => {
  const names = extractMetricNames(
    'sum(increase(ftth_copilot_worker_jobs_failed_total{queue="ftth-poll"}[15m])) > 5',
  );

  assert.deepEqual(names, ["ftth_copilot_worker_jobs_failed_total"]);
});

test("ignora el sufijo con dos puntos de una regla de recording", () => {
  const names = extractMetricNames("ftth_router_dispatch_ratio:mode15m > 0.5");

  // El nombre de una serie grabada lleva dos puntos, y el corte es la
  // parte que no es un nombre de métrica.
  assert.deepEqual(names, ["ftth_router_dispatch_ratio"]);
});

test("lee las reglas del fichero de alertas real", () => {
  const content = readFileSync(
    join(REPO_ROOT, "docker", "victoriametrics-alerts.yml"),
    "utf8",
  );
  const rules = parseAlertRules(content);

  assert.ok(rules.length > 0);
  assert.ok(rules.some((rule) => rule.name === "FTTHCopilotActiveIncidentsHigh"));
  assert.ok(rules.some((rule) => rule.recording));
});

test("toda alerta del repo consulta métricas que alguien exporta", () => {
  const rules = parseAlertRules(
    readFileSync(join(REPO_ROOT, "docker", "victoriametrics-alerts.yml"), "utf8"),
  );
  const exported = parseExportedMetrics([
    {
      path: "apps/web/lib/metrics/prometheus.ts",
      content: readFileSync(join(REPO_ROOT, "apps/web/lib/metrics/prometheus.ts"), "utf8"),
    },
    {
      path: "services/worker/src/health.ts",
      content: readFileSync(join(REPO_ROOT, "services/worker/src/health.ts"), "utf8"),
    },
    {
      path: "packages/shared/src/laya-metrics.ts",
      content: readFileSync(join(REPO_ROOT, "packages/shared/src/laya-metrics.ts"), "utf8"),
    },
  ]);

  const missing = findUnexportedMetrics(rules, exported);

  assert.deepEqual(missing, [], `métricas huérfanas: ${JSON.stringify(missing)}`);
});

test("un histograma exporta también sus sufijos", () => {
  const exported = parseExportedMetrics([
    {
      path: "worker.ts",
      content: [
        "lines.push('# TYPE ftth_copilot_worker_job_duration_seconds histogram');",
        "lines.push('ftth_copilot_worker_job_duration_seconds_bucket{queue=\"a\",le=\"1\"} 0');",
      ].join("\n"),
    },
  ]);

  assert.ok(exported.has("ftth_copilot_worker_job_duration_seconds_bucket"));
  assert.ok(exported.has("ftth_copilot_worker_job_duration_seconds_sum"));
  assert.ok(exported.has("ftth_copilot_worker_job_duration_seconds_count"));
  assert.equal(
    exported.get("ftth_copilot_worker_job_duration_seconds")?.type,
    "histogram",
  );
});

test("una métrica que nadie exporta queda señalada", () => {
  const rules = parseAlertRules(
    [
      "groups:",
      "  - name: test",
      "    rules:",
      "      - alert: FTThAlgo",
      '        expr: ftth_copilot_algo_inexistente > 0',
      "        for: 5m",
    ].join("\n"),
  );
  const exported = parseExportedMetrics([
    { path: "worker.ts", content: "lines.push('ftth_copilot_worker_uptime_seconds 1');" },
  ]);

  const missing = findUnexportedMetrics(rules, exported);

  assert.deepEqual(missing, [
    { metric: "ftth_copilot_algo_inexistente", rule: "FTThAlgo" },
  ]);
});

test("una serie grabada por el propio fichero no está huérfana", () => {
  const rules = parseAlertRules(
    [
      "groups:",
      "  - name: test",
      "    rules:",
      "      - record: ftth_copilot_worker_queue_depth:max",
      "        expr: max(ftth_copilot_worker_queue_depth)",
    ].join("\n"),
  );
  const exported = parseExportedMetrics([
    { path: "worker.ts", content: "lines.push('ftth_copilot_worker_queue_depth 1');" },
  ]);

  assert.deepEqual(findUnexportedMetrics(rules, exported), []);
});

test("dice qué reglas usan una métrica", () => {
  const rules = parseAlertRules(
    [
      "groups:",
      "  - name: test",
      "    rules:",
      "      - alert: FTThUno",
      "        expr: ftth_copilot_worker_queue_depth > 0",
      "      - alert: FTThDos",
      "        expr: ftth_copilot_worker_queue_depth > 10",
    ].join("\n"),
  );
  const exported = parseExportedMetrics([
    { path: "worker.ts", content: "lines.push('ftth_copilot_worker_queue_depth 1');" },
  ]);

  assert.deepEqual(
    findRulesUsingMetric(rules, exported, "ftth_copilot_worker_queue_depth"),
    ["FTThUno", "FTThDos"],
  );
});
