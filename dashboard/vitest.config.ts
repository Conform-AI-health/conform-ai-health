import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'mongodb://localhost:27017/conformia_test',
      JWT_SECRET: 'conformia-super-secret-jwt-key-for-tests-2026',
      REDIS_URL: 'redis://localhost:6379',
      PORT: '3000',
    },
  },
});

