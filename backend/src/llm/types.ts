import type { ChatMessage } from "../schemas";

export interface StructuredTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** The only surface the rest of the server knows about - easy to mock, easy to swap provider. */
export interface LlmClient {
  /** Forced tool call: returns the model's JSON arguments, never free text. */
  structured(args: {
    system: string;
    messages: ChatMessage[];
    tool: StructuredTool;
    signal: AbortSignal;
    maxTokens?: number;
  }): Promise<unknown>;

  /** Token stream. Yields text deltas only. */
  stream(args: {
    system: string;
    messages: ChatMessage[];
    signal: AbortSignal;
    maxTokens?: number;
    temperature?: number;
  }): AsyncIterable<string>;
}
