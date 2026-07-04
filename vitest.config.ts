import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests resolve workspace packages from source so `pnpm test` works
    // without a prior `pnpm build`.
    alias: {
      "@dip/config": r("./packages/config/src/index.ts"),
      "@dip/domain": r("./packages/domain/src/index.ts"),
      "@dip/db": r("./packages/db/src/index.ts"),
      "@dip/storage": r("./packages/storage/src/index.ts"),
      "@dip/ai": r("./packages/ai/src/index.ts"),
    },
  },
  test: {
    include: ["apps/**/test/**/*.test.ts", "packages/**/test/**/*.test.ts"],
    environment: "node",
  },
});
