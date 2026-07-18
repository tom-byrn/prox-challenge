import { query } from "@anthropic-ai/claude-agent-sdk";
import { createManualTools, MANUAL_TOOL_NAMES } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { EmitEvent } from "./types.js";

export type AgentTurnInput = {
  message: string;
  sessionId?: string;
  emit: EmitEvent;
  signal?: AbortSignal;
};

export async function runAgentTurn({ message, sessionId, emit, signal }: AgentTurnInput) {
  const abortController = new AbortController();
  signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  const mcpServer = createManualTools(emit);
  const model = process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6";
  let streamedText = false;
  let resultText = "";
  let finalSessionId = sessionId;
  let finalCost: number | undefined;

  const response = query({
    prompt: message,
    options: {
      abortController,
      cwd: process.cwd(),
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      allowedTools: MANUAL_TOOL_NAMES,
      mcpServers: { "omnipro-manual": mcpServer },
      strictMcpConfig: true,
      settingSources: [],
      permissionMode: "dontAsk",
      includePartialMessages: true,
      maxTurns: 12,
      maxBudgetUsd: 0.35,
      effort: "medium",
      resume: sessionId,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "arcwell-omnipro/1.0.0"
      }
    }
  });

  try {
    for await (const sdkMessage of response) {
      if (sdkMessage.session_id) finalSessionId = sdkMessage.session_id;

      if (sdkMessage.type === "stream_event") {
        const event = sdkMessage.event;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          streamedText = true;
          await emit({ type: "text_delta", text: event.delta.text });
        }
      }

      if (sdkMessage.type === "result") {
        finalCost = sdkMessage.total_cost_usd;
        if (sdkMessage.subtype === "success") {
          resultText = sdkMessage.result;
        } else {
          throw new Error(sdkMessage.errors.join(" ") || "The agent could not complete this turn.");
        }
      }
    }

    if (!streamedText && resultText) {
      await emit({ type: "text_delta", text: resultText });
    }
    await emit({ type: "done", sessionId: finalSessionId, costUsd: finalCost });
    return { sessionId: finalSessionId, costUsd: finalCost };
  } finally {
    response.close();
  }
}
