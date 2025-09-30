module.exports = {
  testEnvironment: "node",
  testMatch: ["**/*.test.js"],
  collectCoverageFrom: ["scripts/**/*.js", "!scripts/**/*.test.js"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
}
