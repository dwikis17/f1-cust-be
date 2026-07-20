import { AsyncLocalStorage } from "node:async_hooks";

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
const storage = new AsyncLocalStorage<ExecutionContext>();

export function runWithExecutionContext<T>(context: ExecutionContext, callback: () => T) {
  return storage.run(context, callback);
}

export function scheduleBackground(promise: Promise<unknown>) {
  const context = storage.getStore();
  if (context) context.waitUntil(promise);
  else void promise;
}
