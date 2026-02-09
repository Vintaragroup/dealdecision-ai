const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: 2022,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // PR1 guardrail: contracts is type/schema only at runtime.
      // QUEUE_NAMES must be imported from @dealdecision/core.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@dealdecision/contracts",
              importNames: ["QUEUE_NAMES"],
              message:
                "Do not import QUEUE_NAMES from @dealdecision/contracts. Import it from @dealdecision/core.",
            },
          ],
        },
      ],
    },
  },
];
