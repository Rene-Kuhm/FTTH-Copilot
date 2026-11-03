/**
 * T1.1 — resolución del interruptor del learning loop.
 *
 * El modo del tenant se resuelve con la misma precedencia que el resto de
 * los knobs de `TenantPolicy` (`retrievalLimit`, `retrievalSinceDays`):
 * `args.X ?? tenantPolicy.X ?? default.X`. El default es `off`: desplegar el
 * código no cambia lo que ve el operador.
 *
 * La resolución vive en `packages/learning` porque es pura y no puede
 * depender de Prisma. `packages/evidence` **no** puede importar este paquete
 * (I1, la pared del Truth Gate), así que el modo viaja por el slice
 * estructural `RetrievalTenantPolicy` y el peso por `confirmedBy` vive en
 * `packages/evidence`.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_LEARNING_MODE, resolveArtifactPins, resolveLearningMode } from '../src/policy';

describe('resolveLearningMode (T1.1)', () => {
  it('sin nada resuelto, el modo es `off`', () => {
    expect(resolveLearningMode()).toBe('off');
    expect(DEFAULT_LEARNING_MODE).toBe('off');
  });

  it('la fila de la política del tenant manda sobre el default', () => {
    expect(resolveLearningMode({ tenantPolicy: { learningMode: 'shadow' } })).toBe('shadow');
    expect(resolveLearningMode({ tenantPolicy: { learningMode: 'active' } })).toBe('active');
  });

  it('el argumento del runtime manda sobre la política del tenant', () => {
    expect(
      resolveLearningMode({
        mode: 'active',
        tenantPolicy: { learningMode: 'shadow' },
      }),
    ).toBe('active');
  });

  it('un valor ausente o nulo cae al siguiente eslabón de la precedencia', () => {
    expect(resolveLearningMode({ mode: null, tenantPolicy: { learningMode: 'active' } })).toBe(
      'active',
    );
    expect(resolveLearningMode({ mode: undefined, tenantPolicy: { learningMode: 'shadow' } })).toBe(
      'shadow',
    );
    expect(resolveLearningMode({ mode: null, tenantPolicy: { learningMode: null } })).toBe('off');
    expect(resolveLearningMode({ tenantPolicy: null })).toBe('off');
  });

  it('la política sin fila es lo mismo que una política con todo en null', () => {
    expect(resolveLearningMode({ tenantPolicy: {} })).toBe('off');
  });
});

describe('resolveArtifactPins (T1.1)', () => {
  it('sin pins resueltos, el mapa está vacío', () => {
    expect(resolveArtifactPins()).toEqual({});
  });

  it('los pins de la política del tenant se usan cuando el runtime no pasa los suyos', () => {
    expect(
      resolveArtifactPins({
        tenantPolicy: { learningArtifactPins: { l1: 'recall-v3' } },
      }),
    ).toEqual({ l1: 'recall-v3' });
  });

  it('los pins del runtime pisan los del tenant', () => {
    expect(
      resolveArtifactPins({
        pins: { l1: 'recall-v4' },
        tenantPolicy: { learningArtifactPins: { l1: 'recall-v3' } },
      }),
    ).toEqual({ l1: 'recall-v4' });
  });

  it('un mapa vacío explícito del runtime pisa los pins del tenant', () => {
    expect(
      resolveArtifactPins({
        pins: {},
        tenantPolicy: { learningArtifactPins: { l1: 'recall-v3' } },
      }),
    ).toEqual({});
  });

  it('la copia devuelta no comparte referencia con la fuente', () => {
    const source = { l1: 'recall-v3' };
    const resolved = resolveArtifactPins({ tenantPolicy: { learningArtifactPins: source } });
    resolved.l1 = 'mutado';
    expect(source.l1).toBe('recall-v3');
  });
});
