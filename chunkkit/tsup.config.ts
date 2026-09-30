import { defineConfig } from "tsup";

export default [
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
  },
  {
    entry: { cli: "bin/cli.ts" },
    format: ["esm"],
    // No banner: bin/cli.ts already starts with its own shebang; adding
    // another here produces a second shebang on line 2, which Node rejects.
    sourcemap: true,
    target: "es2022",
  },
];
