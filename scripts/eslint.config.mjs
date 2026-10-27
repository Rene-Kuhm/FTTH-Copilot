/**
 * ESLint para las herramientas de `scripts/`.
 *
 * Comparte las reglas del resto de los paquetes no-Next del repo. Vive acá
 * (y no en la raíz) porque `scripts/` no es un workspace de pnpm: el lint del
 * repo lo corre `mise run lint`.
 */
import sharedConfig from '../eslint.config.shared.mjs';

export default [
  {
    ignores: ['**/node_modules/**'],
  },
  ...sharedConfig,
];
