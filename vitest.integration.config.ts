import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 300000, // 5 min — container builds are slow
    hookTimeout: 300000,
    pool: "forks", // Each test gets its own process (isolation for Docker)
    poolOptions: {
      forks: {
        singleFork: true, // Run sequentially to avoid Docker conflicts
      },
    },
  },
});
