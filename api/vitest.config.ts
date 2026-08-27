import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // De integratietests praten met een echte PostGIS-database en moeten dus
    // niet door elkaar heen lopen. De unittests zijn puur en mogen wel parallel.
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
