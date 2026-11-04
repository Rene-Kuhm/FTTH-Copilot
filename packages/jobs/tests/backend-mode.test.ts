import { describe, expect, it } from 'vitest';
import {
  BACKEND_MODES,
  DEFAULT_BACKEND_MODE,
  assertWorkerBackendMode,
} from '../src/backend-mode';

describe('el modo del backend', () => {
  it('el modo por defecto es el worker', () => {
    expect(DEFAULT_BACKEND_MODE).toBe(BACKEND_MODES.worker);
  });

  it('el worker es el único modo: no queda un camino embedded', () => {
    expect(Object.keys(BACKEND_MODES)).toEqual(['worker']);
  });

  it('un entorno sin el flag es válido: el worker es el dueño', () => {
    expect(() => assertWorkerBackendMode({})).not.toThrow();
  });

  it('acepta el flag en worker', () => {
    expect(() => assertWorkerBackendMode({ BACKEND_MODE: 'worker' })).not.toThrow();
  });

  it('ignora mayúsculas y espacios alrededor', () => {
    expect(() => assertWorkerBackendMode({ BACKEND_MODE: '  WORKER ' })).not.toThrow();
  });

  it('rechaza el camino embedded: ya no existe', () => {
    // Un entorno heredado que diga `embedded` es un entorno sin migrar. Si
    // aceptáramos el valor, la web seguiría sirviendo HTTP y nadie polosaría:
    // el fallo sería silencioso, y de los que se descubren semanas después.
    expect(() => assertWorkerBackendMode({ BACKEND_MODE: 'embedded' })).toThrow(/embedded/);
  });

  it('rechaza un valor desconocido y dice cuál recibió', () => {
    expect(() => assertWorkerBackendMode({ BACKEND_MODE: 'distributed' })).toThrow(
      /BACKEND_MODE="distributed"/,
    );
  });
});
