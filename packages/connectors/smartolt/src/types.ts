/**
 * Tipos específicos de la API de SmartOLT (basados en su doc pública).
 * Mantener sincronizado con /docs/api-samples/smartolt/.
 */

export interface SmartOltApiResponse<T> {
  status: boolean;
  response: T;
}
