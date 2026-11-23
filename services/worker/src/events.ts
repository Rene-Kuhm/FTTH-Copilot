/**
 * El stream de eventos de SmartOLT en el worker.
 *
 * El worker es el único dueño del trabajo de fondo, así que es el único que
 * abre el stream. El loop en sí vive en `@ftth-copilot/scheduler` (junto al
 * poll, la auditoría de firmware y el barrido FEC); este módulo es el arranque
 * y el apagado, y el log que dice si quedó encendido.
 *
 * Está apagado por default: `SMARTOLT_EVENTS_ENABLED=true` es lo único que lo
 * enciende. Apagado, el worker no lista conexiones, no abre sockets y no
 * publica nada en la salud, así que una instalación que no lo pidió se comporta
 * exactamente igual que antes.
 */
import {
  startSmartoltEventStreams,
  type SmartoltEventLoopHandle,
  type SmartoltEventLoopOptions,
} from '@ftth-copilot/scheduler';
import { createLogger } from '@ftth-copilot/shared';

const log = createLogger({ name: 'worker-events' });

/** Opciones del arranque: las mismas del loop del scheduler. */
export type WorkerEventStreamsOptions = SmartoltEventLoopOptions;

/** El stream en marcha, desde el punto de vista del worker. */
export interface WorkerEventStreamsHandle {
  /** Si quedó encendido (la bandera del entorno). */
  readonly enabled: boolean;
  /** Cuántos streams se abrieron. */
  readonly connections: number;
  /** Corta los streams y espera a que los loops salgan. */
  stop(): Promise<void>;
}

/**
 * Arranca el stream de eventos de cada conexión SmartOLT conectada.
 *
 * Devuelve enseguida: el listado de conexiones es asíncrono y el arranque del
 * worker no puede esperarlo (los sockets y el handler de apagado dependen de
 * que siga). El log del arranque sale cuando el listado terminó.
 */
export function startWorkerSmartoltEventStreams(
  options: WorkerEventStreamsOptions = {},
): WorkerEventStreamsHandle {
  const loop: SmartoltEventLoopHandle = startSmartoltEventStreams(options);

  if (!loop.enabled) {
    log.info('SmartOLT event stream disabled (SMARTOLT_EVENTS_ENABLED is not "true")');
    return {
      enabled: false,
      connections: 0,
      stop: async () => {},
    };
  }

  void loop.ready
    .then(() => {
      log.info('SmartOLT event stream started', { connections: loop.connections });
    })
    .catch((error: unknown) => {
      log.error('SmartOLT event stream could not start', { error });
    });

  return {
    get enabled(): boolean {
      return loop.enabled;
    },
    get connections(): number {
      return loop.connections;
    },
    stop: () => loop.stop(),
  };
}
