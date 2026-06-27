import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Worker code uses only Web-standard APIs (Request/Response/fetch),
    // which exist in modern Node, so the default node environment is sufficient.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
