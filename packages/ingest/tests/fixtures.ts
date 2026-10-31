import dgram from 'node:dgram';

/**
 * Shared helpers of the ingest specs.
 *
 * The specs bind real UDP sockets on the loopback interface: the receiver is
 * a socket, and a fake one would not prove that a datagram reaches the spool.
 */

/**
 * A free UDP port, asked from the kernel.
 *
 * A fixed port collides with whatever else listens on the machine (this
 * repo's own demo stack binds 15514/15515), and reusing a port also races
 * the previous listener of a suite: closing a dgram socket is asynchronous,
 * so the next bind would fail with EADDRINUSE. Asking for port 0 solves
 * both.
 */
export function freeUdpPort(): Promise<number> {
  const probe = dgram.createSocket('udp4');
  return new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.bind(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Waits for `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a datagram to the receiver and waits for it to be delivered.
 *
 * `send` only queues the datagram in the kernel: the receiver needs a moment
 * to read it and write it to the spool.
 */
export function sendDatagram(port: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const payload = Buffer.from(message, 'utf8');
    client.send(payload, port, '127.0.0.1', (err) => {
      client.close();
      if (err) reject(err);
      else resolve();
    });
  });
}
