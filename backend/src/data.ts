import fs from "node:fs";
import path from "node:path";
import { ApprovalsResponseSchema, type Approval } from "./schemas";

const DATA_DIR = path.resolve(__dirname, "../data");

/** Seed queue. Validated on load so a malformed fixture fails at boot, not mid-demo. */
export function loadApprovals(): Approval[] {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "approvals.json"), "utf8"));
  return ApprovalsResponseSchema.parse({ approvals: raw }).approvals;
}

export function loadPolicy(): string {
  return fs.readFileSync(path.join(DATA_DIR, "policy.md"), "utf8");
}
