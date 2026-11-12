import { createApp } from "./app";
import { loadConfig } from "./config";
import { loadApprovals, loadPolicy } from "./data";
import { AnthropicLlm } from "./llm/anthropic";
import { chunkPolicy } from "./rag";
import { createAiService } from "./services/aiService";

const config = loadConfig();
const policyText = loadPolicy();
const approvals = loadApprovals();

const llm = config.anthropicApiKey ? new AnthropicLlm(config.anthropicApiKey, config.model) : null;
if (!llm) console.warn("[api] ANTHROPIC_API_KEY not set - every AI action will use its built-in fallback.");

const app = createApp({
  service: createAiService({
    llm,
    approvals,
    policyText,
    policyChunks: chunkPolicy(policyText),
    timeoutMs: config.llmTimeoutMs
  }),
  approvals,
  rateLimit: { windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }
});

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port} (model: ${llm ? config.model : "none"})`);
});
