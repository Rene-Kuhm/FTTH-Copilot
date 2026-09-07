import sharedConfig from '../../../eslint.config.shared.mjs';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**'],
  },
  ...sharedConfig,
];
