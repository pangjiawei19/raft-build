// `@botiverse/raft-sdk/agent`: the agent layer. `createRaftAgent` gives an
// agent runtime identity, inbox, read, reply, tasks, interrupts, next steps and
// model-readable `text`, built on the program-layer client at the package root
// (`createRaftClient`). It may evolve faster than the root; breaking changes
// are called out in the CHANGELOG.
export { createRaftAgent } from "./raft";
export type { CreateRaftAgentOptions, RaftAgent } from "./raft";
export { createRaftAgentFromStore } from "./credential";
export type { CreateRaftAgentFromStoreOptions } from "./credential";
// Errors either factory throws, so a caller can catch them from this entry.
export { RaftSdkConfigurationError } from "./client";
export type { RaftSdkConfigurationErrorCode } from "./client";
export { RaftCredentialError } from "./credential";
export type { RaftCredentialErrorCode, RaftCredentialStore } from "./credential";
export * from "./agentExports";
