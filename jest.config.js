/** @type {import("ts-jest/dist/types").InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.(ts|js)x?$': 'ts-jest',
  },
  transformIgnorePatterns: ['[/\\\\]node_modules[/\\\\](?!quick-lru/).+\\.js$'],
  testTimeout: 1000000,
}
