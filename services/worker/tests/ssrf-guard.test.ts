import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El worker se niega a arrancar con las excepciones de la política SSRF.
 *
 * Por qué un test que lee el fuente y no uno que importa el módulo: el
 * `index.ts` del worker es el punto de entrada del proceso —importarlo
 * levanta el worker entero—, así que no se puede ejercitar como una
 * función. Lo que importa es *cuándo* ocurre la comprobación: si queda
 * después de que arrancan los workers o los receptores, no sirve de nada,
 * porque para entonces el proceso ya está haciendo trabajo de fondo con la
 * política abierta.
 */
describe('el arranque del worker', () => {
  it('comprueba las excepciones SSRF antes de arrancar los workers', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '../src/index.ts'),
      'utf8',
    );

    const guard = source.indexOf('assertNoSsrfExceptionsInProduction');
    const boot = source.indexOf('bootWorkers(');

    expect(guard).toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(boot);
  });

  it('importa la comprobación del paquete de conectores', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, '../src/index.ts'),
      'utf8',
    );

    expect(source).toContain('@ftth-copilot/connectors-core');
  });
});
