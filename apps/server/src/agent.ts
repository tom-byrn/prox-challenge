import { query } from "@anthropic-ai/claude-agent-sdk";
import { createManualTools, MANUAL_TOOL_NAMES, type ManualToolContext } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { makeRepairPrompt, validateAgentResponse } from "./response-validator.js";
import { ampsFromMessage, getTurnPolicy, inputVoltageFromMessage, processFromMessage } from "./turn-policy.js";
import type { AgentEvent, EmitEvent } from "./types.js";

export type AgentTurnInput = {
  message: string;
  sessionId?: string;
  emit: EmitEvent;
  signal?: AbortSignal;
  queryAgent?: typeof query;
};

type AttemptResult = {
  events: AgentEvent[];
  text: string;
  calledTools: Set<string>;
  sessionId?: string;
  costUsd?: number;
};

function isBufferedContent(event: AgentEvent): boolean {
  return event.type === "text_delta" || event.type === "clarification_request" || event.type === "evidence" || event.type === "figure" || event.type === "video" || event.type === "widget" || event.type === "visual" || event.type === "artifact";
}

function agentOptions({
  abortController,
  mcpServer,
  model,
  resume,
  repair
}: {
  abortController: AbortController;
  mcpServer: ReturnType<typeof createManualTools>;
  model: string;
  resume?: string;
  repair: boolean;
}) {
  return {
    abortController,
    cwd: process.cwd(),
    model,
    systemPrompt: SYSTEM_PROMPT,
    tools: [] as string[],
    allowedTools: MANUAL_TOOL_NAMES,
    mcpServers: { "omnipro-manual": mcpServer },
    strictMcpConfig: true,
    settingSources: [],
    permissionMode: "dontAsk" as const,
    includePartialMessages: true,
    maxTurns: repair ? 8 : 12,
    maxBudgetUsd: repair ? 0.15 : 0.35,
    effort: "medium" as const,
    resume,
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "arcwell-omnipro/1.0.0"
    }
  };
}

async function runAttempt({
  prompt,
  resume,
  repair,
  emit,
  abortController,
  model,
  queryAgent,
  toolContext
}: {
  prompt: string;
  resume?: string;
  repair: boolean;
  emit: EmitEvent;
  abortController: AbortController;
  model: string;
  queryAgent: typeof query;
  toolContext: ManualToolContext;
}): Promise<AttemptResult> {
  const events: AgentEvent[] = [];
  const calledTools = new Set<string>();
  const attemptEmit: EmitEvent = async (event) => {
    if (event.type === "tool_start") calledTools.add(event.name);
    if (isBufferedContent(event)) events.push(event);
    else await emit(event);
  };
  const mcpServer = createManualTools(attemptEmit, toolContext);
  let streamedText = "";
  let resultText = "";
  let finalSessionId = resume;
  let costUsd: number | undefined;

  const response = queryAgent({
    prompt,
    options: agentOptions({ abortController, mcpServer, model, resume, repair })
  });

  try {
    for await (const sdkMessage of response) {
      if (sdkMessage.session_id) finalSessionId = sdkMessage.session_id;

      if (sdkMessage.type === "stream_event") {
        const event = sdkMessage.event;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          streamedText += event.delta.text;
          await attemptEmit({ type: "text_delta", text: event.delta.text });
        }
      }

      if (sdkMessage.type === "result") {
        costUsd = sdkMessage.total_cost_usd;
        if (sdkMessage.subtype === "success") {
          resultText = sdkMessage.result;
        } else {
          throw new Error(sdkMessage.errors.join(" ") || "The agent could not complete this turn.");
        }
      }
    }

    if (!streamedText && resultText) {
      await attemptEmit({ type: "text_delta", text: resultText });
    }

    return {
      events,
      text: resultText || streamedText,
      calledTools,
      sessionId: finalSessionId,
      costUsd
    };
  } finally {
    response.close();
  }
}

export async function runAgentTurn({ message, sessionId, emit, signal, queryAgent = query }: AgentTurnInput) {
  const policy = getTurnPolicy(message);
  const toolContext: ManualToolContext = {
    originalQuestion: message,
    process: processFromMessage(message),
    inputVoltage: inputVoltageFromMessage(message),
    amps: ampsFromMessage(message)
  };
  const abortController = new AbortController();
  signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  const model = process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6";
  const firstAttempt = await runAttempt({
    prompt: message,
    resume: sessionId,
    repair: false,
    emit,
    abortController,
    model,
    queryAgent,
    toolContext
  });
  const cumulativeTools = new Set(firstAttempt.calledTools);
  let finalAttempt = firstAttempt;
  const firstValidationIssues = validateAgentResponse(policy, {
    text: firstAttempt.text,
    events: firstAttempt.events,
    calledTools: cumulativeTools
  });
  let validationIssues = firstValidationIssues;
  let repaired = false;
  let totalCost = firstAttempt.costUsd;

  if (validationIssues.length > 0 && !abortController.signal.aborted) {
    repaired = true;
    const repairAttempt = await runAttempt({
      prompt: makeRepairPrompt(message, validationIssues),
      resume: firstAttempt.sessionId,
      repair: true,
      emit,
      abortController,
      model,
      queryAgent,
      toolContext
    });
    for (const toolName of repairAttempt.calledTools) cumulativeTools.add(toolName);
    totalCost = (totalCost ?? 0) + (repairAttempt.costUsd ?? 0);
    const repairValidationIssues = validateAgentResponse(policy, {
      text: repairAttempt.text,
      events: repairAttempt.events,
      calledTools: cumulativeTools
    });
    if (repairValidationIssues.length <= firstValidationIssues.length) {
      finalAttempt = repairAttempt;
      validationIssues = repairValidationIssues;
    }
  }

  for (const event of finalAttempt.events) await emit(event);
  await emit({ type: "done", sessionId: finalAttempt.sessionId, costUsd: totalCost });

  return {
    sessionId: finalAttempt.sessionId,
    costUsd: totalCost,
    repaired,
    validationIssues
  };
}
