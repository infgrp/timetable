/// <reference lib="webworker" />
import { solve } from "./solver";
import type { SolveRequest, WorkerOut } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<SolveRequest>) => {
  const post = (msg: WorkerOut) => ctx.postMessage(msg);
  const result = solve(e.data, (restarts, bestConflicts, totalUnits, elapsedMs) => {
    post({ type: "progress", restarts, bestConflicts, totalUnits, elapsedMs });
  });
  post({ type: "done", ...result });
};
