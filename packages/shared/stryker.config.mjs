export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/types.ts',
    '!src/contracts.ts',
    '!src/design-system/**',
  ],
  reporters: ['clear-text', 'html', 'json', 'progress'],
  coverageAnalysis: 'perTest',
  disableTypeChecks: true,
  thresholds: { high: 80, low: 59, break: null },
  concurrency: '50%',
  timeoutMS: 30000,
  vitest: { configFile: 'vitest.config.ts' },
};
