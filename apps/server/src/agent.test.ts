import assert from "node:assert/strict";
import test from "node:test";
import { runWithAgentDeadline } from "./agent.js";

test("agent deadline aborts work and returns a useful timeout error", async () => {
  let aborted = false;
  const work = runWithAgentDeadline(10, undefined, async (signal) => {
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    });
    return "unreachable";
  });

  await assert.rejects(work, /response reached its time limit/i);
  assert.equal(aborted, true);
});

test("agent deadline forwards an external cancellation", async () => {
  const external = new AbortController();
  const work = runWithAgentDeadline(1_000, external.signal, async (signal) => {
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return "unreachable";
  });

  external.abort(new Error("user cancelled"));
  await assert.rejects(work, /user cancelled/i);
});
