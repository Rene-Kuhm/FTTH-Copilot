import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LAB_DEFAULTS, bbsimRestUrl, labConfig } from '../lib/lab-config.ts';

test('labConfig falls back to the loopback ports the compose file publishes', () => {
  const config = labConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.deepEqual(config.ports, {
    bbsimRest: 15071,
    bbsimGrpc: 15060,
    snmpsim: 16100,
    chrRest: 15080,
    chrSnmp: 16101,
  });
  assert.equal(config.bbsim.ponPorts, 4);
  assert.equal(config.bbsim.onusPerPon, 2);
  assert.equal(bbsimRestUrl(config), 'http://127.0.0.1:15071');
});

test('labConfig keeps the lab credentials and the SNMP community', () => {
  const config = labConfig({});
  assert.equal(config.chr.adminUser, 'admin');
  assert.equal(config.chr.adminPassword, LAB_DEFAULTS.chr.adminPassword);
  assert.equal(config.chr.snmpCommunity, 'ftthlab');
  assert.equal(config.chr.restUrl, 'http://127.0.0.1:15080');
});

test('labConfig honours the LAB_* environment overrides', () => {
  const config = labConfig({
    LAB_HOST: '127.0.0.2',
    LAB_BBSIM_REST_PORT: '25071',
    LAB_BBSIM_GRPC_PORT: '25060',
    LAB_SNMPSIM_PORT: '26100',
    LAB_CHR_REST_PORT: '25080',
    LAB_CHR_SNMP_PORT: '26101',
    LAB_CHR_ADMIN_USER: 'labadmin',
    LAB_CHR_ADMIN_PASSWORD: 'other-lab-password',
    LAB_CHR_SNMP_COMMUNITY: 'otherlab',
  });
  assert.equal(config.host, '127.0.0.2');
  assert.equal(config.ports.bbsimRest, 25071);
  assert.equal(config.ports.bbsimGrpc, 25060);
  assert.equal(config.ports.snmpsim, 26100);
  assert.equal(config.ports.chrRest, 25080);
  assert.equal(config.ports.chrSnmp, 26101);
  assert.equal(config.chr.adminUser, 'labadmin');
  assert.equal(config.chr.adminPassword, 'other-lab-password');
  assert.equal(config.chr.snmpCommunity, 'otherlab');
  // Derived from the overridden host and port, so both stay in sync.
  assert.equal(config.chr.restUrl, 'http://127.0.0.2:25080');
  assert.equal(bbsimRestUrl(config), 'http://127.0.0.2:25071');
});

test('labConfig lets LAB_CHR_REST_URL win over the derived URL', () => {
  const config = labConfig({ LAB_CHR_REST_URL: 'http://192.0.2.10:15080' });
  assert.equal(config.chr.restUrl, 'http://192.0.2.10:15080');
});

test('labConfig rejects a port that is not a port', () => {
  assert.throws(() => labConfig({ LAB_SNMPSIM_PORT: 'udp' }), /LAB_SNMPSIM_PORT must be a TCP\/UDP port/);
  assert.throws(() => labConfig({ LAB_CHR_REST_PORT: '70000' }), /LAB_CHR_REST_PORT must be a TCP\/UDP port/);
  assert.throws(() => labConfig({ LAB_BBSIM_GRPC_PORT: '0' }), /LAB_BBSIM_GRPC_PORT must be a TCP\/UDP port/);
});
