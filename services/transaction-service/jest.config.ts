import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  collectCoverageFrom: ["src/**/*.ts"],
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
      branches: 75,
      functions: 80,
    },
  },
};

export default config;
