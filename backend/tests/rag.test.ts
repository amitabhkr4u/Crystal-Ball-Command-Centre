import { chunkPolicy, retrieve } from "../src/rag";
import { loadPolicy } from "../src/data";

const chunks = chunkPolicy(loadPolicy());

describe("chunkPolicy", () => {
  it("splits the policy note into 5 titled chunks with stable ids", () => {
    expect(chunks.map((c) => c.id)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(chunks[0].title).toBe("Review order");
    expect(chunks.every((c) => c.text.length > 40)).toBe(true);
  });
});

describe("retrieve", () => {
  it("finds the file-type checks for a PDF question", () => {
    const hits = retrieve(chunks, "What should I check on a PDF?");
    expect(hits[0].chunk.id).toBe("P2");
  });

  it("matches across word forms (rejected / reject)", () => {
    const ids = retrieve(chunks, "When should I reject something?").map((h) => h.chunk.id);
    expect(ids).toContain("P3");
  });

  it("finds escalation rules", () => {
    expect(retrieve(chunks, "Who do I escalate to?")[0].chunk.id).toBe("P4");
  });

  it("returns nothing for a question the policy does not cover", () => {
    expect(retrieve(chunks, "What is the capital of France?")).toEqual([]);
  });

  it("respects k", () => {
    expect(retrieve(chunks, "reject approve review", 1)).toHaveLength(1);
  });
});
