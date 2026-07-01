import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/globalSetup.ts',
    env: {
      DATABASE_URL: 'file:./test.db',
      MASTER_KEY: 'test-master-key-0123456789abcdef',
      LOG_LEVEL: 'silent',
      TBM_PROXY_UPSTREAM: 'mock',
      TBM_WEBHOOK_BACKOFF_MS: '20',
      TBM_WEBHOOK_MAX_ATTEMPTS: '4',
    },
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
