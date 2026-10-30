import { currentRandomUnit } from "./clock";

// Word lists for a suggested agent name ("adjective-noun", e.g. `swift-otter`).
// Lowercase ASCII only, no spaces: every pair must pass validateAgentName
// (NAME_REGEX, NAME_MAX_LENGTH, reserved names), which the test checks for the
// full cross product. The name becomes the agent's @handle, so keep words
// friendly and unambiguous; add words here, nowhere else.
export const AGENT_NAME_ADJECTIVES = [
  "amber", "bold", "brave", "breezy", "bright", "brisk", "calm", "candid", "cheery", "clever",
  "cosmic", "crisp", "curious", "daring", "dashing", "deft", "eager", "earnest", "easy", "fancy",
  "fearless", "fleet", "fluent", "frank", "fresh", "gentle", "giddy", "glad", "golden", "grand",
  "happy", "hardy", "hearty", "honest", "humble", "jolly", "jovial", "keen", "kind", "lively",
  "lucid", "lucky", "lunar", "mellow", "merry", "mighty", "misty", "modest", "nimble", "noble",
  "patient", "peppy", "plucky", "polite", "proud", "quick", "quiet", "radiant", "rapid", "ready",
  "regal", "rosy", "rustic", "sage", "serene", "sharp", "shiny", "silent", "silver", "sincere",
  "sleek", "smooth", "snappy", "solar", "sparkly", "spry", "steady", "stellar", "sturdy", "sunny",
  "swift", "tidy", "tranquil", "trusty", "upbeat", "vivid", "warm", "wise", "witty", "zesty",
] as const;

export const AGENT_NAME_NOUNS = [
  "badger", "beaver", "bison", "comet", "condor", "cougar", "coyote", "crane", "cricket", "dolphin",
  "eagle", "falcon", "ferret", "finch", "firefly", "fox", "gazelle", "gecko", "heron", "ibis",
  "jaguar", "kestrel", "koala", "lark", "lemur", "leopard", "lynx", "magpie", "marten", "meadow",
  "meteor", "mink", "moose", "nebula", "newt", "ocelot", "orca", "osprey", "otter", "owl",
  "panda", "panther", "parrot", "pelican", "penguin", "petrel", "pika", "plover", "puffin", "quail",
  "quasar", "raven", "robin", "salmon", "seal", "sparrow", "squirrel", "starling", "stork", "swallow",
  "hawk", "tapir", "tern", "thrush", "tiger", "toucan", "turtle", "walrus", "weasel", "whale",
  "wombat", "wren", "yak", "zebra", "aurora", "breeze", "canyon", "cedar", "cloud", "delta",
  "ember", "fjord", "glacier", "harbor", "island", "lagoon", "maple", "orbit", "pebble", "summit",
] as const;

/**
 * A suggested agent name, `adjective-noun`, picked at random from the pairs
 * not in `exclude` (names already taken, compared case-insensitively), so it
 * never collides while any pair is free. Only when every pair is taken does it
 * return a taken one, and the server's uniqueness check decides.
 */
export function suggestAgentName(
  exclude: Iterable<string> = [],
  random: () => number = currentRandomUnit,
): string {
  const taken = new Set([...exclude].map((name) => name.trim().toLowerCase()));
  const all = AGENT_NAME_ADJECTIVES.flatMap((adjective) => AGENT_NAME_NOUNS.map((noun) => `${adjective}-${noun}`));
  const free = all.filter((name) => !taken.has(name));
  const pool = free.length > 0 ? free : all;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}
