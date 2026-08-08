import { AsyncLocalStorage } from "node:async_hooks";

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type ExecutionState = { context: ExecutionContext; promises: Promise<unknown>[] };
const storage = new AsyncLocalStorage<ExecutionState>();

export function runWithExecutionContext<T>(context: ExecutionContext, callback: () => T) {
  return storage.run({ context, promises: [] }, callback);
}

export function scheduleBackground(promise: Promise<unknown>) {
  const state = storage.getStore();
  if (state) {
    state.promises.push(promise);
    state.context.waitUntil(promise);
  }
  else void promise;
}

export function waitForBackgroundTasks() {
  const state = storage.getStore();
  return state ? Promise.allSettled(state.promises) : Promise.resolve([]);
}
