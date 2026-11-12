import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, StructuredTool } from "./types";
import type { ChatMessage } from "../schemas";

/** Claude via the Anthropic SDK. Runs server-side only; the key never reaches the browser. */
export class AnthropicLlm implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string
  ) {
    // Retries are off: our own 8s deadline + fallback path is the retry policy.
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async structured(args: {
    system: string;
    messages: ChatMessage[];
    tool: StructuredTool;
    signal: AbortSignal;
    maxTokens?: number;
  }): Promise<unknown> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: args.maxTokens ?? 700,
        system: args.system,
        messages: args.messages,
        tools: [
          {
            name: args.tool.name,
            description: args.tool.description,
            input_schema: args.tool.input_schema as Anthropic.Tool.InputSchema
          }
        ],
        tool_choice: { type: "tool", name: args.tool.name }
      },
      { signal: args.signal }
    );
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("Model did not return a tool_use block");
    return block.input;
  }

  async *stream(args: {
    system: string;
    messages: ChatMessage[];
    signal: AbortSignal;
    maxTokens?: number;
    temperature?: number;
  }): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: args.maxTokens ?? 500,
        system: args.system,
        messages: args.messages,
        ...(args.temperature !== undefined ? { temperature: args.temperature } : {})
      },
      { signal: args.signal }
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
