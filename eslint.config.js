import js from "@eslint/js";

export default [
  { ignores: ["node_modules/**", ".worktrees/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process:       "readonly",
        console:       "readonly",
        Buffer:        "readonly",
        setTimeout:    "readonly",
        clearTimeout:  "readonly",
        setInterval:   "readonly",
        clearInterval: "readonly",
        URL:             "readonly",
        URLSearchParams: "readonly",
        fetch:           "readonly",
        AbortController: "readonly",
        AbortSignal:     "readonly",
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  },
  {
    files: ["tests/**/*.test.js"],
    languageOptions: {
      globals: {
        describe:   "readonly",
        it:         "readonly",
        test:       "readonly",
        expect:     "readonly",
        beforeAll:  "readonly",
        afterAll:   "readonly",
        beforeEach: "readonly",
        afterEach:  "readonly",
        jest:       "readonly",
      }
    }
  }
];
