import "dotenv/config";

export interface AppConfig {
  port: number;
  anthropicApiKey: string | undefined;
  model: string;
  llmTimeoutMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: int(env.PORT, 4000),
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
    llmTimeoutMs: int(env.LLM_TIMEOUT_MS, 8000),
    rateLimitMax: int(env.RATE_LIMIT_MAX, 20),
    rateLimitWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000)
  };
}
