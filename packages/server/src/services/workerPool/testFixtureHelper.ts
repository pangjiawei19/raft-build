/**
 * Helper module imported by testFixtureHandlers.ts via a normal extensionless
 * relative import, proving that handlers with ordinary cross-module
 * dependencies work inside a real spawned worker (the xlsx preview consumer
 * will pull in providers/xlsx + SheetJS the same way).
 */
export function fixtureTransform(payload: unknown): unknown {
  return { echoed: payload, transformedBy: "testFixtureHelper.fixtureTransform" };
}
