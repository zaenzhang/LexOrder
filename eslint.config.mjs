import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  globalIgnores([
    ".next/**",
    ".next-dev/**",
    ".next-build/**",
    ".next-personal/**",
    "output/ledger-preview/**", // 独立测试库预览的 Next.js 生成产物
    "tools/workbench-m1/.runtime/**",
    "tools/workbench-m1/prototype/.runtime/**",
    "tools/workbench-m1/prototype/.next/**",
    "tools/workbench-m1/prototype/next-env.d.ts",
    "desktop/personal-chronicle/**",
    "node_modules/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts"
  ])
]);

export default eslintConfig;
