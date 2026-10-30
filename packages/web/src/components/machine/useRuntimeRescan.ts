import { useCallback, useEffect, useRef, useState } from "react";

/**
 * task #1268: the recovery action for an `incomplete` runtime detection.
 * Tracks the request so the page can show "rescanning", and a rejected
 * request (403, offline, network) is surfaced instead of swallowed. State is
 * never written after unmount.
 */
export type RuntimeRescanState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "failed"; error: string };

export function describeRescanError(error: unknown): string {
  const e = error as { response?: { status?: number; data?: { error?: unknown } }; message?: unknown } | null;
  const status = e?.response?.status;
  if (status === 403) return "forbidden";
  if (typeof status === "number") return `http_${status}`;
  return "network";
}

export function useRuntimeRescan(
  machineId: string,
  rescanRuntimes: (machineId: string) => Promise<void>,
): { state: RuntimeRescanState; rescan: () => void } {
  const [state, setState] = useState<RuntimeRescanState>({ status: "idle" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const rescan = useCallback(() => {
    setState({ status: "running" });
    rescanRuntimes(machineId).then(
      () => { if (mounted.current) setState({ status: "idle" }); },
      (error: unknown) => { if (mounted.current) setState({ status: "failed", error: describeRescanError(error) }); },
    );
  }, [machineId, rescanRuntimes]);
  return { state, rescan };
}
