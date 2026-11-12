import { chunkText, fallbackGreeting, fallbackTriage } from "../src/services/fallbacks";
import { loadApprovals } from "../src/data";
import { TriageSchema } from "../src/schemas";

describe("fallbackTriage (non-AI ranking)", () => {
  const triage = fallbackTriage(loadApprovals());

  it("is schema-valid and covers every approval once", () => {
    expect(TriageSchema.safeParse(triage).success).toBe(true);
    expect(triage.items.map((i) => i.id).sort()).toEqual(["APR-001", "APR-002", "APR-003", "APR-004"]);
  });

  it("follows the policy review order: PDF, Folder, Video, Image", () => {
    expect(triage.items.map((i) => i.id)).toEqual(["APR-003", "APR-001", "APR-002", "APR-004"]);
  });
});

describe("chunkText", () => {
  it("round-trips the original text", () => {
    const text = "One two three four five six seven eight nine ten.";
    expect(chunkText(text).join("")).toBe(text);
    expect(chunkText(text).length).toBeGreaterThan(1);
  });
});

describe("fallbackGreeting", () => {
  it("mentions the live pending count and time of day", () => {
    const text = fallbackGreeting(loadApprovals(), new Date(2026, 8, 18, 9, 0));
    expect(text).toMatch(/morning/i);
    expect(text).toContain("4 approvals");
  });
});
