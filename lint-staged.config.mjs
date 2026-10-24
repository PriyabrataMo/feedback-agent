/**
 * Lint and format staged frontend files only. Python files are handled by
 * pre-commit from the same Husky hook.
 */
const config = {
  "apps/web/**/*.{js,mjs,cjs,ts,tsx}": [
    "bunx eslint --config apps/web/eslint.config.mjs --fix",
    "bunx prettier --config apps/web/.prettierrc --write",
  ],
  "apps/web/**/*.{json,css,md,yml,yaml}":
    "bunx prettier --config apps/web/.prettierrc --write",
};

export default config;
