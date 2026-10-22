import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "shared/**/*.test.ts"],
    server: { deps: { inline: ["convex-test", "@convex-dev/prosemirror-sync"] } },
  },
});
