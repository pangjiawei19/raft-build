import assert from "node:assert/strict";

import { sendAuthenticatedMachineContext } from "./machineContext";
import { serverMachineContextCapabilities } from "../runtimeOutcomeOutboxIngest";

test("authenticated machine context serializes the exact accepted owner identities", () => {
  const sent: string[] = [];
  sendAuthenticatedMachineContext({ send: (data) => sent.push(data) }, {
    machineId: "machine-1",
    serverId: "server-1",
  });
  // task #1268: the server now always advertises at least the async-detection
  // capability, so the frame carries the current list verbatim.
  assert.deepEqual(sent.map((data) => JSON.parse(data)), [{
    type: "machine:context",
    machineId: "machine-1",
    serverId: "server-1",
    capabilities: serverMachineContextCapabilities(),
  }]);
  assert.ok(serverMachineContextCapabilities().includes("machine:runtime-detection-async-v1"));
});

test("machine context send failure is synchronous so the route can fail closed", () => {
  assert.throws(() => sendAuthenticatedMachineContext({
    send: () => { throw new Error("socket closed"); },
  }, {
    machineId: "machine-1",
    serverId: "server-1",
  }), /socket closed/);
});

// task #1268: the WebSocket 101 response pre-reads the same capability list
// the `machine:context` frame carries, and `machine:context` now declares
// ready-before-detection.
import { machineUpgradeCapabilitiesHeader } from "../routes/daemon";
import { RAFT_SERVER_CAPABILITIES_HEADER, SERVER_CAPABILITY_RUNTIME_DETECTION_ASYNC_V1 } from "@botiverse/raft-shared";

test("task #1268: machine:context and the upgrade response both declare runtime-detection-async-v1", () => {
  const caps = serverMachineContextCapabilities();
  assert.ok(caps.includes(SERVER_CAPABILITY_RUNTIME_DETECTION_ASYNC_V1));
  assert.ok(serverMachineContextCapabilities(false).includes(SERVER_CAPABILITY_RUNTIME_DETECTION_ASYNC_V1), "offered even when outbox acks are off");
  const header = machineUpgradeCapabilitiesHeader(caps);
  assert.ok(header);
  assert.match(header!, new RegExp(`^${RAFT_SERVER_CAPABILITIES_HEADER}: `));
  assert.ok(header!.split(": ")[1]!.split(" ").includes(SERVER_CAPABILITY_RUNTIME_DETECTION_ASYNC_V1));
  assert.equal(machineUpgradeCapabilitiesHeader([]), null, "no header when nothing is advertised");
  assert.equal(machineUpgradeCapabilitiesHeader([" ", ""]), null);
});
