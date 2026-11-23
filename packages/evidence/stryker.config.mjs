export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: ['src/**/*.ts', '!src/index.ts', '!src/types.ts'],
  reporters: ['clear-text', 'html', 'json', 'progress'],
  coverageAnalysis: 'perTest',
  disableTypeChecks: true,
  thresholds: { high: 80, low: 76, break: null },
  concurrency: '50%',
  timeoutMS: 30000,
  vitest: { configFile: 'vitest.config.ts' },
};
