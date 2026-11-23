/**
 * Minimal SNMP v2c `GET` client used by the virtual bench smoke test.
 *
 * The bench has to prove that the value snmpsim serves is the value the capture
 * recorded, and that the MikroTik CHR answers SNMP on a loopback port. Doing it
 * from the host with a few dozen lines of BER is cheaper than pulling a full
 * SNMP library into the repository root: `net-snmp` is a dependency of
 * `@ftth-copilot/monitoring`, not of the root workspace, and adding it here
 * would mean a new dependency for a test bench.
 *
 * Only what the bench needs is implemented: v2c, `GET`, and the value types an
 * agent returns for `sysDescr`.
 */
import { createSocket, type Socket } from 'node:dgram';

/** SNMP v2c protocol version field. */
const SNMP_VERSION_2C = 1;

const TAG_INTEGER = 0x02;
const TAG_OCTET_STRING = 0x04;
const TAG_NULL = 0x05;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;
const TAG_GET_REQUEST = 0xa0;
const TAG_GET_RESPONSE = 0xa2;

const TAG_COUNTER32 = 0x41;
const TAG_GAUGE32 = 0x42;
const TAG_TIMETICKS = 0x43;
const TAG_NO_SUCH_OBJECT = 0x80;
const TAG_NO_SUCH_INSTANCE = 0x81;
const TAG_END_OF_MIB_VIEW = 0x82;

/** A decoded variable binding. */
export interface VarBind {
  readonly oid: string;
  /** Human-readable value: strings as-is, numbers in decimal. */
  readonly value: string;
}

/** A decoded `GetResponse` PDU. */
export interface GetResponse {
  readonly requestId: number;
  readonly errorStatus: number;
  readonly errorIndex: number;
  readonly varBinds: readonly VarBind[];
}

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}

/** BER integer, minimal two's complement for the values an SNMP message uses. */
function encodeInteger(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new Error(`cannot encode ${value} as a positive SNMP INTEGER`);
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0x00);
  return Buffer.from(bytes);
}

function encodeBase128(value: number): number[] {
  const digits = [value & 0x7f];
  let remaining = Math.floor(value / 128);
  while (remaining > 0) {
    digits.unshift((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  return digits;
}

/**
 * Encode a dotted OID into its BER content octets.
 *
 * @throws when the textual form is not a numeric OID with at least two arcs.
 */
export function encodeOid(oid: string): Buffer {
  const arcs = oid.split('.');
  if (arcs.length < 2) throw new Error(`"${oid}" is not an OID`);
  const numbers = arcs.map((arc) => {
    const value = Number(arc);
    if (!Number.isInteger(value) || value < 0) throw new Error(`"${oid}" is not a numeric OID`);
    return value;
  });
  const first = numbers[0] ?? 0;
  const second = numbers[1] ?? 0;
  if (first > 2) throw new Error(`"${oid}": the first OID arc is 0, 1 or 2`);
  const bytes = [first * 40 + second];
  for (const arc of numbers.slice(2)) bytes.push(...encodeBase128(arc));
  return Buffer.from(bytes);
}

/** Build an SNMP v2c `GetRequest` for one OID. */
export function encodeGetRequest(community: string, oid: string, requestId: number): Buffer {
  const varBind = encodeTlv(
    TAG_SEQUENCE,
    Buffer.concat([
      encodeTlv(TAG_OID, encodeOid(oid)),
      encodeTlv(TAG_NULL, Buffer.alloc(0)),
    ]),
  );
  const pdu = encodeTlv(
    TAG_GET_REQUEST,
    Buffer.concat([
      encodeTlv(TAG_INTEGER, encodeInteger(requestId)),
      encodeTlv(TAG_INTEGER, encodeInteger(0)),
      encodeTlv(TAG_INTEGER, encodeInteger(0)),
      encodeTlv(TAG_SEQUENCE, varBind),
    ]),
  );
  return encodeTlv(
    TAG_SEQUENCE,
    Buffer.concat([
      encodeTlv(TAG_INTEGER, encodeInteger(SNMP_VERSION_2C)),
      encodeTlv(TAG_OCTET_STRING, Buffer.from(community, 'utf8')),
      pdu,
    ]),
  );
}

interface Tlv {
  readonly tag: number;
  readonly value: Buffer;
  readonly next: number;
}

function readTlv(buffer: Buffer, offset: number): Tlv {
  if (offset >= buffer.length) throw new Error('truncated SNMP message: missing tag');
  const tag = buffer[offset] ?? 0;
  let cursor = offset + 1;
  if (cursor >= buffer.length) throw new Error('truncated SNMP message: missing length');
  const first = buffer[cursor] ?? 0;
  cursor += 1;
  let length = first;
  if ((first & 0x80) !== 0) {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw new Error('unsupported SNMP length encoding');
    length = 0;
    for (let index = 0; index < count; index += 1) {
      if (cursor >= buffer.length) throw new Error('truncated SNMP length');
      length = length * 256 + (buffer[cursor] ?? 0);
      cursor += 1;
    }
  }
  const end = cursor + length;
  if (end > buffer.length) throw new Error('truncated SNMP value');
  return { tag, value: buffer.subarray(cursor, end), next: end };
}

function readInteger(value: Buffer): number {
  if (value.length === 0) return 0;
  let result = 0;
  for (const byte of value) result = result * 256 + byte;
  return result;
}

/** Decode a BER OID into its dotted form. */
export function decodeOid(value: Buffer): string {
  if (value.length === 0) throw new Error('empty OID');
  const first = value[0] ?? 0;
  const arcs: number[] = [Math.floor(first / 40), first % 40];
  let current = 0;
  for (const byte of value.subarray(1)) {
    current = current * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      arcs.push(current);
      current = 0;
    }
  }
  return arcs.join('.');
}

function decodeValue(tag: number, value: Buffer): string {
  switch (tag) {
    case TAG_OCTET_STRING:
      return value.toString('utf8').replace(/\0+$/, '');
    case TAG_INTEGER:
      return String(readInteger(value));
    case TAG_OID:
      return decodeOid(value);
    case TAG_COUNTER32:
    case TAG_GAUGE32:
    case TAG_TIMETICKS:
      return String(readInteger(value));
    case TAG_NULL:
      return '';
    case TAG_NO_SUCH_OBJECT:
      throw new Error('the agent answered noSuchObject');
    case TAG_NO_SUCH_INSTANCE:
      throw new Error('the agent answered noSuchInstance');
    case TAG_END_OF_MIB_VIEW:
      throw new Error('the agent answered endOfMibView');
    default:
      throw new Error(`unsupported SNMP value tag 0x${tag.toString(16)}`);
  }
}

/** Decode an SNMP v2c `GetResponse`. */
export function decodeGetResponse(buffer: Buffer): GetResponse {
  const message = readTlv(buffer, 0);
  if (message.tag !== TAG_SEQUENCE) throw new Error('not an SNMP message');
  let cursor = 0;
  const version = readTlv(message.value, cursor);
  if (version.tag !== TAG_INTEGER) throw new Error('malformed SNMP version');
  if (readInteger(version.value) !== SNMP_VERSION_2C) {
    throw new Error('the agent did not answer SNMP v2c');
  }
  cursor = version.next;
  const community = readTlv(message.value, cursor);
  if (community.tag !== TAG_OCTET_STRING) throw new Error('malformed SNMP community');
  cursor = community.next;
  const pdu = readTlv(message.value, cursor);
  if (pdu.tag !== TAG_GET_RESPONSE) {
    throw new Error(`expected a GetResponse PDU, got tag 0x${pdu.tag.toString(16)}`);
  }

  let inner = 0;
  const requestId = readTlv(pdu.value, inner);
  inner = requestId.next;
  const errorStatus = readTlv(pdu.value, inner);
  inner = errorStatus.next;
  const errorIndex = readTlv(pdu.value, inner);
  inner = errorIndex.next;
  const varBindList = readTlv(pdu.value, inner);

  const varBinds: VarBind[] = [];
  let varCursor = 0;
  while (varCursor < varBindList.value.length) {
    const varBind = readTlv(varBindList.value, varCursor);
    varCursor = varBind.next;
    let partCursor = 0;
    const oidTlv = readTlv(varBind.value, partCursor);
    partCursor = oidTlv.next;
    const valueTlv = readTlv(varBind.value, partCursor);
    varBinds.push({
      oid: decodeOid(oidTlv.value),
      value: decodeValue(valueTlv.tag, valueTlv.value),
    });
  }

  return {
    requestId: readInteger(requestId.value),
    errorStatus: readInteger(errorStatus.value),
    errorIndex: readInteger(errorIndex.value),
    varBinds,
  };
}

export interface SnmpGetOptions {
  readonly host: string;
  readonly port: number;
  readonly community: string;
  readonly oid: string;
  /** Per-attempt timeout. */
  readonly timeoutMs?: number;
  /** Attempts before giving up (UDP is lossy, even on loopback). */
  readonly attempts?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_ATTEMPTS = 2;

function sendAndReceive(request: Buffer, options: SnmpGetOptions): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<Buffer>((resolve, reject) => {
    const socket: Socket = createSocket({ type: 'udp4' });
    let settled = false;
    const finish = (error: Error | null, response?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(response as Buffer);
    };
    const timer = setTimeout(
      () => finish(new Error(`no SNMP response from ${options.host}:${options.port}`)),
      timeoutMs,
    );
    socket.on('error', (error) => finish(error));
    socket.on('message', (message) => finish(null, message));
    socket.send(request, options.port, options.host, (error) => {
      if (error) finish(error);
    });
  });
}

/**
 * SNMP v2c `GET` of one OID.
 *
 * @throws when the agent does not answer, answers with an error status, or
 *   returns a value type this client cannot render.
 */
export async function snmpGet(options: SnmpGetOptions): Promise<string> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const requestId = Math.floor(Math.random() * 0x7fffffff);
  const request = encodeGetRequest(options.community, options.oid, requestId);
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = decodeGetResponse(await sendAndReceive(request, options));
      if (response.errorStatus !== 0) {
        throw new Error(
          `the agent returned error-status ${response.errorStatus} at index ${response.errorIndex}`,
        );
      }
      const varBind = response.varBinds[0];
      if (!varBind) throw new Error('the agent returned an empty varbind list');
      return varBind.value;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error('SNMP GET failed');
}
