import fc from 'fast-check';
import { expect, it } from 'vitest';
import {
  MikrowispResponseShapeError,
  parseMikrowispClientes,
  parseMikrowispMonitoreo,
  parseMikrowispOdbs,
  parseMikrowispRouters,
} from '../src/schemas';

const replay = { seed: Number(process.env.FUZZ_SEED ?? 250025), path: process.env.FUZZ_PATH };
const endpoint = '/GetRouters';

it('normalizes the status code and preserves router rows', () => {
  const routers = fc.array(fc.record({ id: fc.nat(), ip: fc.constant('198.51.100.10') }), { maxLength: 12 });
  fc.assert(fc.property(fc.integer({ min: 200, max: 599 }), routers, (code, rows) => {
    expect(parseMikrowispRouters({ estado: 'exito', code, routers: rows }, endpoint))
      .toEqual({ estado: 'exito', code: String(code), routers: rows });
  }), { ...replay, numRuns: 200, examples: [[200, []], [200, [{ id: 1, ip: '198.51.100.10' }]]] });
});

it.each([
  ['/GetRouters', 'routers', parseMikrowispRouters],
  ['/GetMonitoreo', 'equipos', parseMikrowispMonitoreo],
  ['/GetAllClients', 'clientes', parseMikrowispClientes],
  ['/SmartOltGetODB', 'odbs', parseMikrowispOdbs],
] as const)('accepts arbitrary JSON or returns a typed shape error for %s', (route, key, parse) => {
  const json = fc.jsonValue({ maxDepth: 3 });
  const payload = fc.oneof(json, fc.record({ estado: json, code: json, [key]: json }));
  fc.assert(fc.property(payload, (value) => {
    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(value, route);
    } catch (error) {
      expect(error).toBeInstanceOf(MikrowispResponseShapeError);
      expect(error).toMatchObject({ endpoint: route, code: 'RESPONSE_SHAPE' });
      return;
    }
    expect(parsed).toMatchObject({ [key]: expect.any(Array) });
  }), { ...replay, numRuns: 200, examples: [[null], [[]], [{ [key]: [] }]] });
});

it('reports malformed router arrays without echoing the response', () => {
  const malformedRouters = fc.oneof(
    fc.boolean(), fc.integer(), fc.string({ maxLength: 128 }), fc.constant([null]),
  );
  fc.assert(fc.property(malformedRouters, fc.nat(), (routers, id) => {
    const marker = `synthetic-payload-marker-${id}`;
    let failure: unknown;
    try {
      parseMikrowispRouters({ estado: 'exito', mensaje: marker, routers }, endpoint);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(MikrowispResponseShapeError);
    expect(failure).toMatchObject({ endpoint });
    expect(String(failure)).not.toContain(marker);
    expect(JSON.stringify(failure)).not.toContain(marker);
  }), { ...replay, numRuns: 200, examples: [[false, 0], [[null], 1]] });
});
