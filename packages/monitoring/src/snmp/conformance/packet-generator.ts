/**
 * SNMP Packet Generator for Conformance Testing (Roadmap Fase 7).
 *
 * Provides utilities to transform recorded vendor fixtures into binary
 * SNMP packets (v1, v2c, v3) and synthesize edge-case / malformed packets
 * for fuzzing and property-based verification.
 */

import type { SendSnmpTrapOptions } from '../test-client';
import type { SnmpVersion } from '../types';

export interface FixtureVarbind {
  oid: string;
  type?: string | number;
  value: unknown;
  rawHex?: string;
}

export interface FixtureTrapItem {
  description: string;
  version?: string;
  trapOid: string;
  senderIp?: string;
  senderPort?: number;
  varbinds: FixtureVarbind[];
  expected?: Record<string, unknown>;
}

/**
 * Converts a JSON fixture trap definition into executable SendSnmpTrapOptions.
 */
export function fixtureTrapToSendOptions(
  item: FixtureTrapItem,
  targetPort: number,
  targetHost = '127.0.0.1',
): SendSnmpTrapOptions {
  // Normalize version
  let version: SnmpVersion = 'v2c';
  if (item.version === 'v1') {
    version = 'v1';
  } else if (item.version === 'v3') {
    version = 'v3';
  }

  // Filter out standard header varbinds if fixture includes sysUpTime / snmpTrapOID explicitly
  const customVarbinds = (item.varbinds ?? []).filter((vb) => {
    // 1.3.6.1.2.1.1.3.0 is sysUpTime; 1.3.6.1.6.3.1.1.4.1.0 is snmpTrapOID
    return vb.oid !== '1.3.6.1.2.1.1.3.0' && vb.oid !== '1.3.6.1.6.3.1.1.4.1.0';
  });

  return {
    port: targetPort,
    host: targetHost,
    version,
    trapOid: item.trapOid,
    varbinds: customVarbinds.map((vb) => ({
      oid: vb.oid,
      type: vb.type,
      value: vb.value,
    })),
  };
}

/**
 * Generates synthetic raw bytes representing malformed ASN.1 structures.
 */
export function generateSyntheticMalformedBytes(
  anomaly: 'truncated_sequence' | 'oversized_length' | 'invalid_tag' | 'deep_recursion' | 'zero_length',
): Buffer {
  switch (anomaly) {
    case 'truncated_sequence':
      // SEQUENCE tag (0x30) declaring length 0x20, but payload is truncated to 3 bytes
      return Buffer.from([0x30, 0x20, 0x02, 0x01, 0x00]);

    case 'oversized_length':
      // SEQUENCE tag declaring length 0x7F (or multi-byte 0x82 0xFF 0xFF) with only 2 bytes following
      return Buffer.from([0x30, 0x82, 0x0f, 0xff, 0x02, 0x01]);

    case 'invalid_tag':
      // Reserved/invalid ASN.1 tag (0xFF)
      return Buffer.from([0xff, 0x04, 0x01, 0x02, 0x03, 0x04]);

    case 'deep_recursion': {
      // 50 nested empty SEQUENCE headers
      const depth = 50;
      const buf = Buffer.alloc(depth * 2);
      for (let i = 0; i < depth; i++) {
        buf[i * 2] = 0x30;
        buf[i * 2 + 1] = Math.max(0, (depth - i - 1) * 2);
      }
      return buf;
    }

    case 'zero_length':
      return Buffer.alloc(0);

    default:
      return Buffer.from([0x00]);
  }
}
