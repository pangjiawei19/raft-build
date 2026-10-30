import { CliError } from "../../core/errors";

/**
 * A channel command's target, given positionally or as `--target` (as
 * `channel join` and `channel mute` take it). Agents reach for `--target` by
 * habit; both forms work, and they must agree when both are given.
 */
export function positionalOrFlagTarget(positional: string | undefined, flag: string | undefined): string {
  const fromArg = positional?.trim() ?? "";
  const fromFlag = flag?.trim() ?? "";
  if (fromArg && fromFlag && fromArg !== fromFlag) {
    throw new CliError({
      code: "INVALID_ARG",
      message: "Positional target and --target must refer to the same channel when both are provided",
    });
  }
  return fromFlag || fromArg;
}
