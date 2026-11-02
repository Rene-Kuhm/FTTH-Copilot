/**
 * Error de entrada del learning loop.
 *
 * Las funciones del paquete son puras y no "arreglan" datos: si el llamador
 * le pasa una fila rota, se lo dice en vez de descartarla en silencio.
 */
export class LearningInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearningInputError';
  }
}
