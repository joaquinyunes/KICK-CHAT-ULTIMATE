// @ts-check
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "public/**", "coverage/**", "scripts/copy-worker.js"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Pragmático: el código legacy usa `any` a mansalva. Lo marcamos pero no rompe el build.
      "@typescript-eslint/no-explicit-any": "warn",
      // Legacy: hay bastante código sin usar. Se reporta pero no rompe CI.
      // Bajalo a "error" a medida que limpiés cada archivo.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Necesario para augmentar Express.Request (declare global { namespace Express })
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Bugs reales
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-fallthrough": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
    },
  },
  prettier,
);
