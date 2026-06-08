// @ts-check
/**
 * ESLint flat config — owns the CORE IMPORT-GRAPH BOUNDARY (the old hand-rolled
 * readdirSync+regex purity scan in test/contract.test.ts is gone; ESLint enforces
 * it now). HARD RULE: every file under src/** EXCEPT src/adapters/** and
 * src/zod.ts must import NONE of `zod` (incl. `zod/*` subpaths), `node:*`, `hono`,
 * or `@cloudflare/workers-types`. This keeps the frozen core's runtime import
 * graph minimal + binding-free so it runs unchanged on Node, workerd, and bun.
 *
 * Rationale for the zod ban specifically (not portability — zod is pure JS and
 * runs everywhere): zod stays an OPTIONAL peer reached only via the off-barrel
 * /zod subpath, so it is opt-in / zero-bytes-by-default in the consumer's bundled
 * Worker and the engine never resolves the consumer's zod version. The
 * import-graph ban is the cheap, CI-decidable proxy for that.
 */
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";

/** Modules the frozen core must never pull into its runtime import graph. */
const FORBIDDEN_IN_CORE = [
  "zod",
  "hono",
  "@cloudflare/workers-types",
];
/** Patterns (subpaths) of the same — e.g. `zod/v4`, `node:fs`, `hono/*`. */
const FORBIDDEN_PATTERNS = [
  "zod/*",
  "node:*",
  "hono/*",
  "@cloudflare/workers-types/*",
];

const noRestrictedImports = [
  "error",
  {
    paths: FORBIDDEN_IN_CORE.map((name) => ({
      name,
      message:
        "Forbidden in the frozen core import graph. Only src/adapters/** and src/zod.ts may import this.",
    })),
    patterns: [
      {
        group: FORBIDDEN_PATTERNS,
        message:
          "Forbidden in the frozen core import graph. Only src/adapters/** and src/zod.ts may import this.",
      },
    ],
  },
];

export default [
  {
    // Generated / vendored / report artifacts are not linted.
    ignores: ["dist/**", "node_modules/**", "etc/**", "docs/**"],
  },
  {
    // Plain JS (this config file itself): the recommended baseline + Node globals.
    files: ["**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  {
    // TypeScript files: parse with the typescript-eslint parser so TS syntax is
    // understood. This config exists to enforce the import BOUNDARY, not to do
    // full TS lint (tsc --noEmit owns type correctness), so the espree-oriented
    // core rules that misread TS constructs (type-only decls, ambient globals,
    // overload signatures) are disabled — they would be false positives here.
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off", // tsc's noUnusedLocals/overloads handle this; espree misfires on TS
      "no-undef": "off", // TS resolves globals/types; espree does not know them
      "no-redeclare": "off", // TS function overload signatures are legal redeclarations
    },
  },
  {
    // The core import boundary applies to ALL of src/**…
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": noRestrictedImports,
    },
  },
  {
    // …EXCEPT the exempt zone: adapters and the optional zod subpath may import
    // zod (incl. zod/v4) and would-be-forbidden binding/runtime modules.
    files: ["src/adapters/**/*.ts", "src/zod.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
