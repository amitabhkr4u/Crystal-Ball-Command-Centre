import { LlmTimeoutError, streamWithIdleTimeout, withTimeout } from "../src/llm/timeout";

const never = <T>() => new Promise<T>(() => undefined);

describe("withTimeout", () => {
  it("resolves when the call finishes in time", async () => {
    await expect(withTimeout(200, async () => "ok")).resolves.toBe("ok");
  });

  it("rejects with LlmTimeoutError and aborts the signal when the call stalls", async () => {
    let signalSeen: AbortSignal | undefined;
    await expect(
      withTimeout(30, (signal) => {
        signalSeen = signal;
        return never<string>();
      })
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(signalSeen?.aborted).toBe(true);
  });
});

describe("streamWithIdleTimeout", () => {
  it("passes tokens through", async () => {
    async function* open() {
      yield "a";
      yield "b";
    }
    const out: string[] = [];
    for await (const t of streamWithIdleTimeout(200, () => open())) out.push(t);
    expect(out).toEqual(["a", "b"]);
  });

  it("times out when the first token never arrives", async () => {
    async function* open() {
      await never<void>();
      yield "never";
    }
    const run = async () => {
      for await (const _ of streamWithIdleTimeout(30, () => open())) void _;
    };
    await expect(run()).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it("times out when the stream goes quiet after some tokens", async () => {
    async function* open() {
      yield "first";
      await never<void>();
    }
    const seen: string[] = [];
    const run = async () => {
      for await (const t of streamWithIdleTimeout(30, () => open())) seen.push(t);
    };
    await expect(run()).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(seen).toEqual(["first"]);
  });
});
