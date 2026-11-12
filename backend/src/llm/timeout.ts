export class LlmTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`LLM call exceeded ${ms}ms`);
    this.name = "LlmTimeoutError";
  }
}

/** Race a call against a deadline; aborts the underlying request when the deadline wins. */
export async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LlmTimeoutError(ms));
    }, ms);
  });
  const call = run(controller.signal);
  call.catch(() => undefined); // a late rejection after the deadline must not become unhandled
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Idle timeout for streams: the deadline restarts on every token, so a long
 * answer is fine but a stalled connection is cut after `ms` of silence.
 */
export async function* streamWithIdleTimeout(
  ms: number,
  open: (signal: AbortSignal) => AsyncIterable<string>
): AsyncGenerator<string> {
  const controller = new AbortController();
  const iterator = open(controller.signal)[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new LlmTimeoutError(ms));
        }, ms);
      });
      const next = iterator.next();
      next.catch(() => undefined);
      let result: IteratorResult<string>;
      try {
        result = await Promise.race([next, deadline]);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    // Do not await: return() queues behind a pending next() on a stalled generator.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}
