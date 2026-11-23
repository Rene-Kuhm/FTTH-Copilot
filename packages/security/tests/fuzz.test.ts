import fc from 'fast-check';
import { expect, it } from 'vitest';
import { extractSourceIpFromMessage } from '../src/source-ip';
import { parseSyslogMessage } from '../src/syslog';

const replay = { seed: Number(process.env.FUZZ_SEED ?? 250025), path: process.env.FUZZ_PATH };
const priority = fc.integer({ min: 0, max: 191 });
const message = fc.string({ maxLength: 512, unit: 'binary' })
  .filter((value) => !/[\r\n\u2028\u2029]/u.test(value));

it('preserves the priority and payload of RFC 3164 lines', () => {
  fc.assert(fc.property(priority, message, (pri, payload) => {
    expect(parseSyslogMessage(`<${pri}>Aug 30 10:00:00 192.0.2.10 lab: ${payload}`)).toEqual({
      priority: pri,
      facility: Math.floor(pri / 8),
      severity: pri % 8,
      timestamp: 'Aug 30 10:00:00',
      hostname: '192.0.2.10',
      tag: 'lab',
      message: payload.trim(),
    });
  }), { ...replay, numRuns: 200, examples: [[0, ''], [191, 'ONU: señal óptica']] });
});

it('rejects lines without a priority prefix or with priority out of range', () => {
  fc.assert(fc.property(fc.integer({ min: 192, max: 999 }), message, (pri, payload) => {
    expect(parseSyslogMessage(`<${pri}>${payload}`)).toBeNull();
    expect(parseSyslogMessage(`lab: ${payload}`)).toBeNull();
  }), { ...replay, numRuns: 200, examples: [[192, 'lab event']] });
});

it('keeps the parsed priority within bounds for arbitrary text', () => {
  fc.assert(fc.property(fc.string({ maxLength: 512, unit: 'binary' }), (line) => {
    for (const input of [line, `<13>${line}`]) {
      const parsed = parseSyslogMessage(input);
      if (parsed === null) continue;
      expect(parsed.facility).toBeGreaterThanOrEqual(0);
      expect(parsed.facility).toBeLessThanOrEqual(23);
      expect(parsed.severity).toBeGreaterThanOrEqual(0);
      expect(parsed.severity).toBeLessThanOrEqual(7);
      expect(parsed.priority).toBe(parsed.facility * 8 + parsed.severity);
      expect(parsed.message.length).toBeLessThanOrEqual(input.length);
    }
  }), {
    ...replay,
    numRuns: 200,
    examples: [[''], ['<13'], ['<34>1 2026-01-01T00:00:00Z 192.0.2.10 lab - - - link up']],
  });
});

it('preserves the priority and message suffix of RFC 5424 input', () => {
  fc.assert(fc.property(priority, message, (pri, payload) => {
    const line = `<${pri}>1 2026-01-01T00:00:00Z 192.0.2.10 lab - - - event ${payload}`;
    const parsed = parseSyslogMessage(line);
    expect(parsed).toMatchObject({ priority: pri });
    expect(parsed?.message.endsWith(`event ${payload}`.trimEnd())).toBe(true);
  }), { ...replay, numRuns: 200, examples: [[34, 'link up']] });
});

it('extracts a documentation IP or returns the supplied fallback from long messages', () => {
  const filler = fc.constantFrom(' ', 'a', '.', '9', ':');
  fc.assert(fc.property(filler, fc.integer({ min: 4096, max: 65_536 }), fc.boolean(),
    (character, size, includeIp) => {
      const payload = `${character.repeat(size)}${includeIp ? ' from 198.51.100.20' : ''}`;
      const start = performance.now();
      const parsed = parseSyslogMessage(`<13>Aug 30 10:00:00 192.0.2.10 lab: event ${payload}`);
      const ip = extractSourceIpFromMessage(parsed?.message ?? '', '203.0.113.10');
      expect(performance.now() - start).toBeLessThan(500);
      expect(parsed).toMatchObject({ priority: 13, hostname: '192.0.2.10', tag: 'lab' });
      expect(ip).toBe(includeIp ? '198.51.100.20' : '203.0.113.10');
    }), { ...replay, numRuns: 40, examples: [[' ', 65_536, true], ['9', 65_536, false]] });
});
