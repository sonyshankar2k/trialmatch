const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The shared library is ESM source; let Jest load its TypeScript directly.
  moduleNameMapper: {
    '^@trialmatch/shared$': '<rootDir>/../../libs/shared/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Integration tests share one test database, so they run one file at a time.
  maxWorkers: 1,
  testTimeout: 20000,
  coverageDirectory: 'test-output/jest/coverage',
};
