export default {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      testMatch: [
        "<rootDir>/tests/*.test.js",
        "<rootDir>/tests/unit/garbage-prevention.test.js"
      ],
      testPathIgnorePatterns: [
        "/node_modules/",
        "/.worktrees/",
        "/tests/integration/",
        "/tests/e2e/"
      ]
    },
    {
      displayName: "integration",
      testEnvironment: "node",
      testMatch: [
        "<rootDir>/tests/integration/**/*.jest.test.js"
      ],
      testPathIgnorePatterns: [
        "/node_modules/",
        "/.worktrees/"
      ]
    }
  ]
};
