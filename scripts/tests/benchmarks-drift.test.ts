import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function readDocument(name: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'docs', name), 'utf8');
}

function measuredValue(source: string, pattern: RegExp, label: string): string {
  const value = pattern.exec(source)?.[1];
  assert.ok(value, `no se pudo leer ${label} de docs/conformance-benchmark.md`);
  return value;
}

test('docs/benchmarks.md publica las cifras vigentes de conformance-benchmark.md', () => {
  // La verdad vive junto al código: conformance-benchmark.md es el documento
  // regenerado por el laboratorio, y benchmarks.md sólo lo resume. Si el
  // resumen se queda con cifras viejas, este test lo detecta sin correr el
  // benchmark (que muta superficies protegidas).
  const conformance = readDocument('conformance-benchmark.md');
  const benchmarks = readDocument('benchmarks.md');

  const metrics = [
    ['p95', measuredValue(conformance, /\*\*Latency p95\*\* \| \*\*([\d.]+) ms\*\*/, 'p95'), 'ms'],
    [
      'promedio',
      measuredValue(conformance, /\| Latency Avg \| ([\d.]+) ms \|/, 'promedio'),
      'ms',
    ],
    ['p50', measuredValue(conformance, /\| Latency p50 \(Median\) \| ([\d.]+) ms \|/, 'p50'), 'ms'],
    ['p99', measuredValue(conformance, /\| Latency p99 \| ([\d.]+) ms \|/, 'p99'), 'ms'],
    [
      'throughput',
      measuredValue(conformance, /\*\*Throughput\*\*: \*\*([\d.]+) events\/sec\*\*/, 'throughput'),
      'events/sec',
    ],
    [
      'delta de heap',
      measuredValue(
        conformance,
        /Heap delta after 300 traps was \*\*(-?[\d.]+) MB\*\*/,
        'delta de heap',
      ),
      'MB',
    ],
  ] as const;

  for (const [label, value, unit] of metrics) {
    assert.ok(
      benchmarks.includes(`${value} ${unit}`),
      `benchmarks.md no publica ${label} (${value} ${unit}) según conformance-benchmark.md`,
    );
  }

  assert.doesNotMatch(
    benchmarks,
    /1\.328 ms|0\.506 ms|0\.377 ms|3\.447 ms|845 events\/sec|1\.26 MB|845 \/sec/,
    'benchmarks.md todavía contiene cifras del benchmark anterior',
  );

  const section = /## 3\. Latencia del receptor SNMP([\s\S]*?)\n---/.exec(benchmarks)?.[1];
  assert.ok(section, 'no se encontró la sección de latencia SNMP en benchmarks.md');
  assert.match(
    section,
    /conformance-benchmark\.md/,
    'la sección SNMP tiene que citar conformance-benchmark.md como fuente',
  );
});
