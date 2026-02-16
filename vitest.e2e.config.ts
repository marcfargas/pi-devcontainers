import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/pidc-e2e.test.ts"],
    environment: "node",
    testTimeout: 300000, // 5 min — container builds are slow
    hookTimeout: 300000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Sequential — avoid Docker conflicts
      },
    },
  },
});
