/** The handlers a component test gives the stand-in tRPC client, by procedure path such as `requests.get`. */
export const handlers: Record<string, (input: never) => unknown> = {};

/** The inputs each handler was called with, by procedure path. */
export const calls: Record<string, unknown[]> = {};

/** Clears the handlers and the recorded calls. */
export function resetTRPC(): void {
  for (const key of Object.keys(handlers)) delete handlers[key];
  for (const key of Object.keys(calls)) delete calls[key];
}

/** Runs the handler of `path` and records the input. */
async function run(path: string, input: unknown): Promise<unknown> {
  (calls[path] ??= []).push(input);
  const handler = handlers[path];
  if (!handler) throw new Error(`No handler for ${path}`);
  return handler(input as never);
}

/**
 * A stand-in for `useTRPC()`: `trpc.a.b.queryOptions(input)` and `trpc.a.b.mutationOptions(options)` call the handler
 * registered under `a.b`, so a component runs against a real query client without a server.
 */
export function fakeTRPC(path: string[] = []): unknown {
  return new Proxy(() => {}, {
    get(_target, prop: string) {
      const name = path.join(".");
      if (prop === "queryOptions") return (input: unknown) => ({ queryKey: [name, input], queryFn: () => run(name, input) });
      if (prop === "mutationOptions") return (options: object = {}) => ({ ...options, mutationKey: [name], mutationFn: (input: unknown) => run(name, input) });
      return fakeTRPC([...path, prop]);
    },
  });
}
