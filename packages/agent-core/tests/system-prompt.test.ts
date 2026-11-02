import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../src/prompts/system';

/**
 * El prompt del sistema es contrato con el modelo, no texto libre.
 *
 * Los umbrales que dice tienen que ser los mismos que usa el motor de
 * detección, o el técnico ve dos diagnósticos distintos para la misma
 * señal. Los umbrales viven en el código:
 *
 *   - `packages/detection/src/signal-drift.ts` → -27 dBm
 *   - `packages/detection/src/temperature-drift.ts` → 60 °C
 *
 * Antes, el prompt decía -28 dBm y 50/65 °C: rangos que ningún detector usa.
 */
describe('system prompt del agente', () => {
  it('usa el umbral de RX power del motor de detección (-27 dBm)', () => {
    expect(SYSTEM_PROMPT).toContain('**RX power con problema**: < -27 dBm');
    expect(SYSTEM_PROMPT).not.toContain('-28 dBm');
  });

  it('usa el umbral de temperatura del motor de detección (60 °C)', () => {
    expect(SYSTEM_PROMPT).toContain('60°C');
    expect(SYSTEM_PROMPT).not.toContain('50-65°C');
    expect(SYSTEM_PROMPT).not.toContain('65°C');
  });

  it('no ofrece un NMS que el repo no tiene', () => {
    // NetSense no tiene conector: prometerlo hace que el modelo prometa
    // consultas que no puede hacer.
    expect(SYSTEM_PROMPT).not.toContain('NetSense');
  });

  it('manda a la tool de búsqueda por nombre de cliente', () => {
    // La tool existe (`search_by_customer_name`). Filtrar "mentalmente"
    // sobre list_onus es una instrucción que el modelo no puede cumplir.
    expect(SYSTEM_PROMPT).toContain('search_by_customer_name');
    expect(SYSTEM_PROMPT).not.toContain('filtrá mentalmente');
  });

  it('no repite los rangos de señal en dos secciones', () => {
    // Un solo juego de umbrales: dos juegos distintos en el mismo prompt es
    // la forma más fácil de que se contradigan.
    expect(SYSTEM_PROMPT).not.toContain('Rangos típicos de señal GPON');
  });
});
