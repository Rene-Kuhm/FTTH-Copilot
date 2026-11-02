/**
 * Contrato entre las alertas y las métricas que se exportan.
 *
 * Una alerta que consulta una métrica que nadie expone no falla: queda
 * INACTIVE para siempre, y el operador cree que tiene cobertura. Este
 * módulo comprueba esa correspondencia sobre el código, sin red y sin
 * servidor: las funciones son puras y reciben el contenido de los ficheros.
 *
 * Tres fuentes de verdad:
 *
 *   1. `docker/victoriametrics-alerts.yml` — las reglas.
 *   2. Los exportadores (`/api/metrics` de la web, `/metrics` del worker y
 *      las métricas de Laya) — los nombres que existen de verdad.
 *   3. Las reglas de recording del propio fichero de alertas — nombres que
 *      existen porque la propia alerta los define.
 */

import { parse } from 'yaml';

/** A metric that an exporter emits. */
export interface ExportedMetric {
  /** Name of the metric family, without the suffixes of the type. */
  name: string;
  /** Prometheus type: gauge, counter, histogram or summary. */
  type: string;
  /** File the metric comes from. */
  source: string;
}

/** A metric used by an alert or recording rule. */
export interface MetricReference {
  /** Name of the referenced metric. */
  metric: string;
  /** Name of the rule that uses it. */
  rule: string;
}

/** A rule of the alerting file. */
export interface AlertRule {
  /** Name of the alert, or of the recorded series. */
  name: string;
  /** PromQL expression, empty when the rule has none. */
  expr: string;
  /** True when the rule records a series instead of raising an alert. */
  recording: boolean;
}

/** Names of the metric families of a Prometheus exposition. */
const EXPORTED_NAME = /['"`](ftth_[a-z0-9_]+)(?=[{ ])/g;

/** The `# TYPE` line of a family, with its type. */
const TYPE_LINE = /# TYPE (ftth_[a-z0-9_]+) ([a-z]+)/g;

/** Any metric name inside a PromQL expression. */
const METRIC_IN_EXPRESSION = /ftth_[a-z0-9_]+/g;

/**
 * The metric names an expression uses.
 *
 * The names of the recording rules carry a colon (`ftth_x:rate15m`), and the
 * colon is not part of a metric name: the expression is cut there.
 */
export function extractMetricNames(expression: string): string[] {
  const names = expression.match(METRIC_IN_EXPRESSION) ?? [];
  return [...new Set(names)];
}

/**
 * Reads the rules of an alerting file.
 *
 * The YAML is parsed de verdad, no a mano: una regla mal indentada tiene que
 * romper el check, no pasar desapercibida.
 */
export function parseAlertRules(content: string): AlertRule[] {
  const document = parse(content) as { groups?: { rules?: unknown[] }[] } | null;
  const groups = document?.groups ?? [];
  const rules: AlertRule[] = [];

  for (const group of groups) {
    for (const raw of group.rules ?? []) {
      const rule = raw as { alert?: string; record?: string; expr?: string };
      if (rule.alert) {
        rules.push({ name: rule.alert, expr: rule.expr ?? '', recording: false });
      } else if (rule.record) {
        rules.push({ name: rule.record, expr: rule.expr ?? '', recording: true });
      }
    }
  }

  return rules;
}

/**
 * The metrics a set of exporters emits.
 *
 * A family declared with `# TYPE` is exported even when the exposition
 * builds its samples with a template: the type line is the declaration, and
 * the samples follow it.
 *
 * A histogram also exports `_bucket`, `_sum` and `_count`, which is how an
 * alert refers to it.
 */
export function parseExportedMetrics(
  sources: { path: string; content: string }[],
): Map<string, ExportedMetric> {
  const exported = new Map<string, ExportedMetric>();

  for (const source of sources) {
    const types = new Map<string, string>();
    for (const match of source.content.matchAll(TYPE_LINE)) {
      types.set(match[1]!, match[2]!);
    }

    for (const [name, type] of types) {
      exported.set(name, { name, type, source: source.path });
      if (type === 'histogram' || type === 'summary') {
        for (const suffix of ['_bucket', '_sum', '_count']) {
          exported.set(`${name}${suffix}`, { name: `${name}${suffix}`, type, source: source.path });
        }
      }
    }

    for (const match of source.content.matchAll(EXPORTED_NAME)) {
      const name = match[1]!;
      if (exported.has(name)) continue;
      exported.set(name, { name, type: 'unknown', source: source.path });
    }
  }

  return exported;
}

/**
 * The metrics a rule uses that nobody exports.
 *
 * The names that the alerting file itself records are not missing: they
 * exist because the file defines them.
 */
export function findUnexportedMetrics(
  rules: AlertRule[],
  exported: Map<string, ExportedMetric>,
): { metric: string; rule: string }[] {
  const defined = new Set(rules.filter((rule) => rule.recording).map((rule) => rule.name));
  const missing: { metric: string; rule: string }[] = [];

  for (const rule of rules) {
    for (const metric of extractMetricNames(rule.expr)) {
      if (exported.has(metric) || defined.has(metric)) continue;
      missing.push({ metric, rule: rule.name });
    }
  }

  return missing;
}

/**
 * The rules that use a metric.
 *
 * It is the other direction of the same contract: it says which alert has
 * to be updated when a metric is renamed.
 */
export function findRulesUsingMetric(
  rules: AlertRule[],
  exported: Map<string, ExportedMetric>,
  metric: string,
): string[] {
  return rules
    .filter((rule) => extractMetricNames(rule.expr).includes(metric))
    .map((rule) => rule.name);
}
