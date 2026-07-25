// Ambient globals a script may set when running under the test harness.
// Both are always undefined in the real Roll20 sandbox.
declare global {
  var __TEST_MODE__: boolean | undefined;
  var __TEST_EXPORTS__: Record<string, unknown> | undefined;
}

export {};
