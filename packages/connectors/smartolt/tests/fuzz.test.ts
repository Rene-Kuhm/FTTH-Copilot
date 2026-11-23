import fc from 'fast-check';
import { expect, it } from 'vitest';
import { SmartoltResponseShapeError } from '../src/errors';
import {
  EVENT_STREAM_ENDPOINT,
  parseEventStreamResponse,
  parseOltsResponse,
  parseOltUptimeResponse,
  parseOnusPageResponse,
  parseSmartoltEventData,
  parseStatusEnvelope,
} from '../src/schemas';

const replay = { seed: Number(process.env.FUZZ_SEED ?? 250025), path: process.env.FUZZ_PATH };
const endpoint = '/api/onu/get_all_onus_details';

it('normalizes page numbers and preserves ONU rows', () => {
  const rows = fc.array(fc.record({ unique_external_id: fc.string({ maxLength: 40 }) }), { maxLength: 12 });
  fc.assert(fc.property(fc.boolean(), fc.nat(10_000), rows, (status, page, onus) => {
    expect(parseOnusPageResponse({ status, page: String(page), onus }, endpoint))
      .toEqual({ status, page, onus });
  }), { ...replay, numRuns: 200, examples: [[true, 1, [{ unique_external_id: 'onu-lab-1' }]]] });
});

it('reports malformed rows through a typed error that omits the raw response', () => {
  const malformedRow = fc.oneof(fc.constant(null), fc.boolean(), fc.integer(), fc.string({ maxLength: 128 }));
  fc.assert(fc.property(malformedRow, fc.nat(), (row, id) => {
    const marker = `synthetic-payload-marker-${id}`;
    let failure: unknown;
    try {
      parseOnusPageResponse({ status: true, onus: [{ note: marker }, row] }, endpoint);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SmartoltResponseShapeError);
    expect(failure).toMatchObject({ endpoint });
    expect(String(failure)).not.toContain(marker);
    expect(JSON.stringify(failure)).not.toContain(marker);
  }), { ...replay, numRuns: 200, examples: [[null, 0], ['truncated row', 1]] });
});

it.each([
  ['/api/system/get_zones', parseStatusEnvelope],
  ['/api/system/get_olts', parseOltsResponse],
  [endpoint, parseOnusPageResponse],
  ['/api/olt/get_olt_uptime_and_env_temperature/olt-lab', parseOltUptimeResponse],
  [EVENT_STREAM_ENDPOINT, parseEventStreamResponse],
] as const)('accepts arbitrary JSON or returns a typed shape error for %s', (route, parse) => {
  const json = fc.jsonValue({ maxDepth: 3 });
  const payload = fc.oneof(json, fc.record({
    status: json,
    response: json,
    olts: json,
    onus: json,
    page: json,
  }));
  fc.assert(fc.property(payload, (value) => {
    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(value, route);
    } catch (error) {
      expect(error).toBeInstanceOf(SmartoltResponseShapeError);
      expect(error).toMatchObject({ endpoint: route, code: 'RESPONSE_SHAPE' });
      return;
    }
    expect(typeof parsed.status).toBe('boolean');
  }), { ...replay, numRuns: 200, examples: [[null], [[]], [{ status: true }]] });
});

it('rejects incomplete SSE JSON and malformed event rows through a typed error', () => {
  const row = fc.oneof(fc.constant(null), fc.boolean(), fc.integer(), fc.string());
  fc.assert(fc.property(row, (value) => {
    const data = JSON.stringify({ type: 'olt.status_fresh', data: { olts: [value] } });
    for (const input of [data, data.slice(0, -1)]) {
      expect(() => parseSmartoltEventData(input)).toThrow(SmartoltResponseShapeError);
    }
  }), { ...replay, numRuns: 200, examples: [[null], [false]] });
});
