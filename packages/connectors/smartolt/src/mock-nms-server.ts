/**
 * El servidor del mock NMS.
 *
 * El staging necesita un NMS contra el que polear: sin él, la conexión que
 * crea el seed no se puede consultar y los loops no tienen nada que hacer.
 *
 * El mock es el del propio repo (`smartoltMockResponse`), servido por HTTP
 * para que lo que se ejercita sea el conector real —el que aplica la
 * política SSRF y habla con `fetch`— y no un atajo por dentro. Un NMS de
 * mentira dentro del proceso no probaría nada del camino que importa.
 *
 * El módulo se puede ejecutar tal cual con node (el tipo se borra en
 * runtime), que es como lo levanta el compose del staging:
 *
 *   node --experimental-strip-types packages/connectors/smartolt/src/mock-nms-server.ts
 *
 * Por eso el import del mock lleva la extensión: node no resuelve los
 * imports sin ella.
 */
import { createServer, type Server } from 'node:http';
import { smartoltMockResponse } from './mock-nms.ts';

/** El puerto por defecto del mock NMS. */
export const MOCK_NMS_DEFAULT_PORT = 18_080;

/** La interfaz por defecto: el loopback, y nada más. */
export const MOCK_NMS_DEFAULT_HOST = '127.0.0.1';

/** Un servidor del mock NMS, ya escuchando. */
export interface MockNmsServer {
  /** La URL a la que apuntar la conexión del tenant. */
  url: string;
  /** El puerto en el que quedó escuchando. */
  port: number;
  /** Cierra el servidor. */
  close(): Promise<void>;
}

/** Opciones del servidor del mock NMS. */
export interface MockNmsServerOptions {
  /** Puerto en el que escuchar. `0` toma uno libre. */
  port?: number;
  /** Interfaz en la que escuchar. */
  host?: string;
}

/**
 * Levanta el servidor del mock NMS.
 *
 * Responde lo que sabe el mock del repo y un 404 con lo que no sabe, que es
 * lo que hace la API real con una ruta desconocida.
 */
export async function createMockNmsServer(
  options: MockNmsServerOptions = {},
): Promise<MockNmsServer> {
  const host = options.host ?? MOCK_NMS_DEFAULT_HOST;
  const requestedPort = options.port ?? MOCK_NMS_DEFAULT_PORT;

  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    const { status, body } = smartoltMockResponse(path);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : requestedPort;

  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * La dirección donde escucha el mock NMS.
 */
export interface MockNmsBinding {
  /** La interfaz. */
  host: string;
  /** El puerto. */
  port: number;
}

/**
 * El mock NMS ya levantado, con la forma de apagarlo.
 */
export interface RunningMockNms {
  /** El servidor. */
  server: MockNmsServer;
  /** Lo apaga y espera a que quede libre el puerto. */
  stop: () => Promise<void>;
}

/**
 * La dirección del mock NMS, según el entorno.
 *
 * El entorno lo puede garbar: si `MOCK_NMS_PORT` no es un número, el mock
 * tiene que caer en el puerto por defecto. Levantarse en un puerto raro —o no
 * levantarse— deja al worker poleando contra nada.
 *
 * El puerto cero es el "elegí uno libre" de Node: lo usan los tests, que no
 * pueden fijar un puerto sin arriesgarse a pisar el de otro proceso.
 */
export function resolveMockNmsBinding(env: NodeJS.ProcessEnv = process.env): MockNmsBinding {
  const parsed = Number.parseInt(env['MOCK_NMS_PORT'] ?? '', 10);
  const host = env['MOCK_NMS_HOST']?.trim() || MOCK_NMS_DEFAULT_HOST;
  const port = Number.isFinite(parsed) && parsed >= 0 ? parsed : MOCK_NMS_DEFAULT_PORT;

  return { host, port };
}

/**
 * Levanta el mock NMS en la dirección que dice el entorno.
 *
 * Es el camino que usa el servicio del compose del staging.
 */
export async function startMockNmsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunningMockNms> {
  const { host, port } = resolveMockNmsBinding(env);
  const server = await createMockNmsServer({ host, port });

  return { server, stop: () => server.close() };
}

/**
 * Levanta el servidor y lo deja en primer plano.
 *
 * Es el punto de entrada del servicio del compose del staging: el proceso
 * vive mientras el servidor escucha.
 */
async function main(): Promise<void> {
  const running = await startMockNmsFromEnv();
  // El punto de entrada de un proceso dice qué está escuchando: es el log
  // que el operador ve cuando el contenedor del staging levanta el mock.
  // eslint-disable-next-line no-console
  console.log(`Mock NMS escuchando en ${running.server.url}`);

  const stop = (): void => {
    void running.stop().finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// El módulo se importa en los tests: sólo se levanta como proceso cuando es
// el punto de entrada.
if (process.argv[1]?.endsWith('mock-nms-server.ts')) {
  void main();
}
