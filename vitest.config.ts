import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), 'server-only': path.resolve(import.meta.dirname, 'tests/stubs/empty.ts') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    maxWorkers: 3,          // cada prueba usa un PostgreSQL embebido: limita la memoria
    env: { APP_ENV: 'test', APP_SECRET: 'test-secret-test-secret-test-secret', EMAIL_PROVIDER: 'log', LOG_LEVEL: 'silent', DATABASE_URL: 'postgres://unused@localhost/unused', DATABASE_SSL: 'disable' },
  },
});
