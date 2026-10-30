import { registerWorkerPoolHandler } from "./handlerRegistry";
import { fixtureTransform } from "./testFixtureHelper";

/**
 * Integration-test fixture: loaded inside the spawned worker via
 * workerData.bootstrapModule, registering a kind whose handler depends on a
 * DIFFERENT module (./testFixtureHelper).
 */
registerWorkerPoolHandler("__fixture_echo", (payload) => fixtureTransform(payload));
