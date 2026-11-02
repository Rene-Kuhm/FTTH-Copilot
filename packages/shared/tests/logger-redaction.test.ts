import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setLogSinkForTests, createLogger } from '../src/logger';

/**
 * The logger must never write a secret, an SNMP community or customer data.
 *
 * This is a property, and it is tested as one: every secret below is a unique
 * sentinel, the line is written through every path a value can take (field,
 * binding, message, error, nested), and the assertion is that the sentinel is
 * **nowhere** in the serialized line. A test that only checked "the key is
 * redacted" would pass while the same value leaked through the message.
 */

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  __setLogSinkForTests((line) => {
    lines.push(line);
  });
});

afterEach(() => {
  __setLogSinkForTests(null);
});

const log = () => createLogger({ name: 'leak-check', level: 'debug' });

function expectNoLeak(sentinel: string): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).not.toContain(sentinel);
  }
}

describe('secrets', () => {
  it.each([
    ['password', { password: 'SENTINEL-password-1' }, 'SENTINEL-password-1'],
    ['token', { token: 'SENTINEL-token-2' }, 'SENTINEL-token-2'],
    ['apiKey', { apiKey: 'SENTINEL-apikey-3' }, 'SENTINEL-apikey-3'],
    ['x-api-key header', { 'x-api-key': 'SENTINEL-header-4' }, 'SENTINEL-header-4'],
    ['authorization', { authorization: 'SENTINEL-auth-5' }, 'SENTINEL-auth-5'],
    ['encryptedKey', { encryptedKey: 'SENTINEL-enc-6' }, 'SENTINEL-enc-6'],
    ['webhookUrl', { webhookUrl: 'https://hooks.example/SENTINEL-hook-7' }, 'SENTINEL-hook-7'],
  ])('redacts the %s field', (_label, fields, sentinel) => {
    log().info('event', fields);

    expectNoLeak(sentinel);
  });

  it('redacts a secret nested deep inside a field', () => {
    log().info('event', { request: { headers: { cookie: 'SENTINEL-cookie-8' } } });

    expectNoLeak('SENTINEL-cookie-8');
  });

  it('redacts a secret inside an array', () => {
    log().info('event', { attempts: [{ secret: 'SENTINEL-secret-9' }] });

    expectNoLeak('SENTINEL-secret-9');
  });

  it('redacts a secret carried by a child binding', () => {
    createLogger({ name: 'x' }).child({ token: 'SENTINEL-binding-10' }).info('event');

    expectNoLeak('SENTINEL-binding-10');
  });

  it('redacts a bearer token written into the message', () => {
    log().info('call failed: Authorization: Bearer SENTINEL-bearer-11');

    expectNoLeak('SENTINEL-bearer-11');
  });

  it('redacts credentials embedded in a URL inside an error message', () => {
    log().error('request failed', {
      err: new Error('connect failed to https://admin:SENTINEL-urlpass-12@router.isp.example/rest'),
    });

    expectNoLeak('SENTINEL-urlpass-12');
  });

  it('redacts credentials that only appear in the stack', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fetch (https://user:SENTINEL-stack-13@host.example/x)';

    log().error('failed', { err: error });

    expectNoLeak('SENTINEL-stack-13');
  });

  it('redacts credentials in the message of the cause', () => {
    log().error('failed', {
      err: new Error('outer', { cause: new Error('Bearer SENTINEL-cause-14') }),
    });

    expectNoLeak('SENTINEL-cause-14');
  });
});

describe('SNMP communities', () => {
  it.each([
    ['community', { community: 'SENTINEL-comm-1' }, 'SENTINEL-comm-1'],
    ['communityString', { communityString: 'SENTINEL-comm-2' }, 'SENTINEL-comm-2'],
    ['snmp_community', { snmp_community: 'SENTINEL-comm-3' }, 'SENTINEL-comm-3'],
    ['readCommunity', { readCommunity: 'SENTINEL-comm-4' }, 'SENTINEL-comm-4'],
    ['writeCommunity', { writeCommunity: 'SENTINEL-comm-5' }, 'SENTINEL-comm-5'],
    ['authKey (SNMPv3)', { authKey: 'SENTINEL-v3-6' }, 'SENTINEL-v3-6'],
    ['privKey (SNMPv3)', { privKey: 'SENTINEL-v3-7' }, 'SENTINEL-v3-7'],
    ['authPassword (SNMPv3)', { authPassword: 'SENTINEL-v3-8' }, 'SENTINEL-v3-8'],
    ['privPassword (SNMPv3)', { privPassword: 'SENTINEL-v3-9' }, 'SENTINEL-v3-9'],
  ])('redacts the %s field', (_label, fields, sentinel) => {
    log().warn('sender rejected', fields);

    expectNoLeak(sentinel);
  });

  it('redacts the community of a sender registry logged as a whole', () => {
    log().info('registry loaded', {
      senders: [
        { senderIp: '10.0.0.1', oltId: 'OLT-1', community: 'SENTINEL-registry-10' },
        { senderIp: '10.0.0.2', oltId: 'OLT-2', community: 'SENTINEL-registry-11' },
      ],
    });

    expectNoLeak('SENTINEL-registry-10');
    expectNoLeak('SENTINEL-registry-11');
  });

  it('redacts the community the receiver puts inside its own error message', () => {
    // The real message of the SNMP receiver, seen in the test output of this
    // repo: the community is part of the text, not of a key.
    log().warn('receiver error', {
      err: new Error(
        'Local community not found for message with community SENTINEL-rogue-12',
      ),
    });

    expectNoLeak('SENTINEL-rogue-12');
  });

  it('redacts a community written as community=value in the message', () => {
    log().warn('bad sender: community=SENTINEL-assign-13 from 10.0.0.9');

    expectNoLeak('SENTINEL-assign-13');
  });

  it('keeps the rest of the community message readable', () => {
    log().warn('Local community not found for message with community SENTINEL-rogue-14');

    const record = JSON.parse(lines[0] ?? '{}') as { msg: string };
    expect(record.msg).toContain('Local community not found for message');
    expect(record.msg).toContain('[REDACTED]');
  });
});

describe('customer data', () => {
  it.each([
    ['email', { email: 'SENTINEL-email-1@customer.example' }, 'SENTINEL-email-1'],
    ['phone', { phone: 'SENTINEL-phone-2' }, 'SENTINEL-phone-2'],
    ['telefono', { telefono: 'SENTINEL-tel-3' }, 'SENTINEL-tel-3'],
    ['movil', { movil: 'SENTINEL-movil-4' }, 'SENTINEL-movil-4'],
    ['cedula', { cedula: 'SENTINEL-cedula-5' }, 'SENTINEL-cedula-5'],
    ['dni', { dni: 'SENTINEL-dni-6' }, 'SENTINEL-dni-6'],
    ['address', { address: 'SENTINEL-address-7' }, 'SENTINEL-address-7'],
    ['direccion', { direccion: 'SENTINEL-dir-8' }, 'SENTINEL-dir-8'],
    ['nombre', { nombre: 'SENTINEL-nombre-9' }, 'SENTINEL-nombre-9'],
    ['customerName', { customerName: 'SENTINEL-cust-10' }, 'SENTINEL-cust-10'],
  ])('redacts the %s field', (_label, fields, sentinel) => {
    log().info('lookup', fields);

    expectNoLeak(sentinel);
  });

  it('redacts a customer record fetched from the NMS and logged by mistake', () => {
    log().debug('onu detail', {
      onu: {
        id: 'ONU-1',
        serial: 'HWTC1234',
        cliente: { nombre: 'SENTINEL-name-11', correo: 'x', telefono: 'SENTINEL-phone-12' },
      },
    });

    expectNoLeak('SENTINEL-name-11');
    expectNoLeak('SENTINEL-phone-12');
  });

  it('redacts an email written into a message', () => {
    log().warn('notification bounced for SENTINEL-mail-13@customer.example');

    expectNoLeak('SENTINEL-mail-13');
  });

  it('redacts an email inside an error message', () => {
    log().error('send failed', { err: new Error('550 user SENTINEL-mail-14@customer.example unknown') });

    expectNoLeak('SENTINEL-mail-14');
  });
});

describe('what stays readable', () => {
  it('keeps the operational fields an operator needs', () => {
    log().info('tick', {
      tenantId: 'tenant-a',
      connectionId: 'conn-1',
      oltId: 'OLT-1',
      sourceIp: '10.0.0.7',
      durationMs: 120,
    });

    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({
      tenantId: 'tenant-a',
      connectionId: 'conn-1',
      oltId: 'OLT-1',
      sourceIp: '10.0.0.7',
      durationMs: 120,
    });
  });

  it('does not touch a message with nothing sensitive in it', () => {
    log().info('schedule "poll-connections" registered every 900000ms');

    const record = JSON.parse(lines[0] ?? '{}') as { msg: string };
    expect(record.msg).toBe('schedule "poll-connections" registered every 900000ms');
  });
});
