/**
 * Contrato de la API HTTP de FTTH-Copilot.
 *
 * Los tipos y los esquemas de acá **no se escriben a mano**: se generan desde
 * `docs/contract/openapi.yaml`, que es la fuente única de verdad de la API.
 * Regenerar con `pnpm contract:generate` (o `mise run contract:generate`).
 *
 * Qué sirve para qué:
 *
 * - `ChatRequest`, `CreateIncidentRequest`, … son los **tipos** que puede
 *   consume un cliente de la API.
 * - `ChatRequestSchema`, `CreateIncidentRequestSchema`, … son los **validadores**
 *   que debe usar el servidor para validar el body que recibe: si el contrato
 *   dice que el mensaje va de 1 a 8000 caracteres, el validador lo rechaza.
 *
 * Regla del repo: un tipo duplicado en dos paquetes es un bug. Si un tipo de
 * la API hace falta en otro módulo, se importa de acá.
 */
export * from './generated/types';
export * from './generated/schemas';
