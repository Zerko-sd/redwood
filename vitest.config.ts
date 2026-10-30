import { defineConfig } from "vitest/config";

// .preview holds generated apps; their tests need their own running environment.
export default defineConfig({
  test: { exclude: ["**/node_modules/**", "**/dist/**", ".preview/**", "data/**"] },
});
