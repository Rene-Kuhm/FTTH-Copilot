/**
 * Comprueba que las alertas consulten métricas que de verdad se exportan.
 *
 * Una alerta sobre una métrica inexistente queda INACTIVE para siempre, y
 * el operador cree que tiene cobertura. Este check corre en el CI y es
 * hermético: lee los ficheros del repo y no toca la red.
 *
 *   pnpm check:observability
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findUnexportedMetrics,
  parseAlertRules,
  parseExportedMetrics,
} from './lib/observability.ts';

/** The alerting rules of the stack. */
const ALERTS_FILE = join('docker', 'victoriametrics-alerts.yml');

/**
 * The exporters of the stack.
 *
 * The web serves `/api/metrics`, the worker serves `/metrics`, and Laya
 * publishes its own series when the decision layer records something.
 */
const EXPORTERS = [
  join('apps', 'web', 'lib', 'metrics', 'prometheus.ts'),
  join('packages', 'shared', 'src', 'laya-metrics.ts'),
  join('services', 'worker', 'src', 'health.ts'),
];

function main(): void {
  const root = process.cwd();
  const rules = parseAlertRules(readFileSync(join(root, ALERTS_FILE), 'utf8'));
  const exported = parseExportedMetrics(
    EXPORTERS.map((path) => ({ path, content: readFileSync(join(root, path), 'utf8') })),
  );

  const missing = findUnexportedMetrics(rules, exported);

  if (missing.length > 0) {
    console.error('Las alertas consultan métricas que nadie exporta:\n');
    for (const { metric, rule } of missing) {
      console.error(`  ${metric} (usada por ${rule})`);
    }
    console.error(
      '\nCada métrica tiene que existir en /api/metrics (web), /metrics (worker) o en las reglas de recording del mismo fichero.',
    );
    process.exit(1);
  }

  console.log(
    `check:observability OK — ${rules.length} reglas, ${exported.size} métricas exportadas, ninguna alerta huérfana.`,
  );
}

main();
