import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...fixupConfigRules([...nextVitals, ...nextTypescript]),
  globalIgnores([".next/**", "**/.cache/**", "generated/**", "test-results/**", "playwright-report/**", "next-env.d.ts"]),
]);
