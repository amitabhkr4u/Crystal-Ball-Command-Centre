import { activePrompts } from "../src/prompts";
import { collect, makeLlm, makeService, metaOf, never, tokensOf, validTriage } from "./helpers";

describe("summary", () => {
  it("validates structured output, then streams the narration", async () => {
    const llm = makeLlm();
    const events = await collect(makeService(llm).summary({ language: "Hindi" }));

    const meta = metaOf(events);
    expect(meta.fallback).toBe(false);
    expect(meta.triage?.items[0].id).toBe("APR-003");
    expect(meta.promptVersion).toBe(activePrompts.summaryNarration.version);
    expect(tokensOf(events)).toBe("Start with the safety PDF.");
    expect(events[events.length - 1]).toEqual({ type: "done", fallback: false });

    expect(llm.structured).toHaveBeenCalledTimes(1);
    const args = llm.structured.mock.calls[0][0];
    expect(args.tool.name).toBe("submit_triage");
    expect(args.system).toContain("Hindi");
  });

  it("rejects a wrong-shaped model response and degrades to the built-in ranking", async () => {
    const llm = makeLlm({
      structured: jest.fn(async () => ({ headline: "x", items: [{ id: "APR-001", priority: "urgent", reason: "r" }] }))
    });
    const events = await collect(makeService(llm).summary({ language: "English" }));

    const meta = metaOf(events);
    expect(meta.fallback).toBe(true);
    expect(meta.reason).toBe("invalid_output");
    expect(meta.triage?.items.map((i) => i.id)).toEqual(["APR-003", "APR-001", "APR-002", "APR-004"]);
    expect(llm.stream).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toEqual({ type: "done", fallback: true });
  });

  it("rejects a triage that invents or omits approval ids", async () => {
    const bad = validTriage();
    bad.items[3].id = "APR-999";
    const llm = makeLlm({ structured: jest.fn(async () => bad) });
    const meta = metaOf(await collect(makeService(llm).summary({ language: "English" })));
    expect(meta.reason).toBe("invalid_output");
  });

  it("falls back on timeout instead of hanging", async () => {
    const llm = makeLlm({ structured: jest.fn(() => never()) });
    const meta = metaOf(await collect(makeService(llm, 30).summary({ language: "English" })));
    expect(meta.fallback).toBe(true);
    expect(meta.reason).toBe("timeout");
  });

  it("falls back with no_api_key when no LLM is configured", async () => {
    const events = await collect(makeService(null).summary({ language: "English" }));
    expect(metaOf(events).reason).toBe("no_api_key");
    expect(tokensOf(events)).toContain("Safety Equipment & Sensor Specs");
  });
});

describe("talk", () => {
  it("forwards the conversation history to the model", async () => {
    const llm = makeLlm();
    const messages = [
      { role: "user" as const, content: "What is pending?" },
      { role: "assistant" as const, content: "Four items." },
      { role: "user" as const, content: "Which first?" }
    ];
    await collect(makeService(llm).talk({ language: "English", messages }));
    expect(llm.stream.mock.calls[0][0].messages).toEqual(messages);
  });

  it("serves a deterministic queue answer when the model errors before any token", async () => {
    const llm = makeLlm({
      stream: jest.fn(() =>
        (async function* () {
          throw new Error("503");
        })()
      )
    });
    const events = await collect(
      makeService(llm).talk({ language: "English", messages: [{ role: "user", content: "hi" }] })
    );
    expect(metaOf(events)).toMatchObject({ fallback: true, reason: "llm_error" });
    expect(tokensOf(events)).toContain("Safety Equipment & Sensor Specs");
  });

  it("emits an error event (no fake done) when the stream dies mid-answer", async () => {
    const llm = makeLlm({
      stream: jest.fn(() =>
        (async function* () {
          yield "Part";
          throw new Error("socket hang up");
        })()
      )
    });
    const events = await collect(
      makeService(llm).talk({ language: "English", messages: [{ role: "user", content: "hi" }] })
    );
    expect(events.map((e) => e.type)).toEqual(["meta", "token", "error"]);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("treats an empty model stream as a failure", async () => {
    const llm = makeLlm({
      stream: jest.fn(() =>
        (async function* () {
          /* nothing */
        })()
      )
    });
    const meta = metaOf(
      await collect(makeService(llm).talk({ language: "English", messages: [{ role: "user", content: "hi" }] }))
    );
    expect(meta.reason).toBe("invalid_output");
  });
});

describe("help (grounded in the policy note)", () => {
  it("retrieves the right chunk and puts it in the prompt", async () => {
    const llm = makeLlm();
    const events = await collect(
      makeService(llm).help({ language: "English", question: "What should I check on a PDF?" })
    );
    expect(metaOf(events).sources?.[0].id).toBe("P2");
    const call = llm.stream.mock.calls[0][0];
    expect(call.messages[0].content).toContain("[P2]");
    expect(call.messages[0].content).toContain("latest version");
    expect(call.system).toMatch(/only/i);
  });

  it("does not call the model when the policy has nothing relevant", async () => {
    const llm = makeLlm();
    const events = await collect(
      makeService(llm).help({ language: "English", question: "What is the capital of France?" })
    );
    expect(llm.stream).not.toHaveBeenCalled();
    expect(metaOf(events)).toMatchObject({ reason: "no_policy_match", sources: [] });
    expect(tokensOf(events)).toMatch(/couldn't find/i);
  });

  it("falls back to the retrieved policy text when the model fails", async () => {
    const llm = makeLlm({
      stream: jest.fn(() =>
        (async function* () {
          throw new Error("boom");
        })()
      )
    });
    const events = await collect(
      makeService(llm).help({ language: "English", question: "What should I check on a PDF?" })
    );
    expect(metaOf(events).fallback).toBe(true);
    expect(tokensOf(events)).toContain("latest version");
  });
});

describe("teach", () => {
  it("starts the lesson itself when there is no history", async () => {
    const llm = makeLlm();
    await collect(makeService(llm).teach({ language: "English", messages: [] }));
    const sent = llm.stream.mock.calls[0][0].messages;
    expect(sent).toHaveLength(1);
    expect(sent[0].role).toBe("user");
    expect(sent[0].content).toMatch(/review/i);
  });

  it("keeps the starter in front of an assistant-first history so roles stay valid", async () => {
    const llm = makeLlm();
    await collect(
      makeService(llm).teach({
        language: "English",
        messages: [
          { role: "assistant", content: "Step 1 ..." },
          { role: "user", content: "What if the video shows a restricted area?" }
        ]
      })
    );
    const sent = llm.stream.mock.calls[0][0].messages;
    expect(sent.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("greeting", () => {
  it("uses a template with the live count when AI is unavailable", async () => {
    const events = await collect(
      makeService(null, 1000, () => new Date(2026, 8, 18, 9, 0)).greeting({ language: "English" })
    );
    expect(tokensOf(events)).toContain("4 approvals");
    expect(metaOf(events).fallback).toBe(true);
  });

  it("asks the model for a fresh, warmer-temperature greeting", async () => {
    const llm = makeLlm();
    await collect(makeService(llm).greeting({ language: "English" }));
    expect(llm.stream.mock.calls[0][0].temperature).toBeGreaterThan(0.5);
    expect(llm.stream.mock.calls[0][0].system).toContain("4");
  });
});
