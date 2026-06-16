import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  shims: false,
});
