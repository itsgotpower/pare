import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Open-core boundary: the AGPL core must never depend on the proprietary
  // cloud/ layer (see cloud/LICENSE). Composition roots — app/api routes and
  // worker.ts — are the sanctioned crossing points, and even they load cloud
  // code via dynamic import() behind a hosted-mode check.
  {
    files: ["lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "mcp/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cloud", "**/cloud/**"],
              message:
                "AGPL core must not import the proprietary cloud/ layer. Wire cloud code at a composition root (app/api route or worker.ts) behind a hosted-mode check.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
