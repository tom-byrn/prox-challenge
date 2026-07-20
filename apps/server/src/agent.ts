import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createManualTools, MANUAL_TOOL_NAMES, type ManualToolContext } from "./tools.js";
import { getUploadedPhoto } from "./photos.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { makeRepairPrompt, validateAgentResponse } from "./response-validator.js";
import { ampsFromMessage, getTurnPolicy, inputVoltageFromMessage, processFromMessage, type TurnPolicy } from "./turn-policy.js";
import type { AgentEvent, EmitEvent, PhotoAttachment, TurnMetrics } from "./types.js";

export type AgentTurnInput = {
  message: string;
  sessionId?: string;
  conversationContext?: Array<{ role: "user" | "assistant"; content: string }>;
  photo?: PhotoAttachment;
  emit: EmitEvent;
  signal?: AbortSignal;
  queryAgent?: typeof query;
};

function promptWithConversationContext(
  message: string,
  conversationContext?: Array<{ role: "user" | "assistant"; content: string }>
): string {
  if (!conversationContext?.length) return message;
  return [
    "Use this bounded recent conversation transcript only as context for the current request.",
    JSON.stringify(conversationContext),
    "Current user request:",
    message
  ].join("\n\n");
}

function promptWithPresentationGuidance(message: string, policy: TurnPolicy): string {
  const kinds = policy.presentation.kinds?.join(", ");
  if (policy.presentation.level === "required") {
    return `${message}\n\n<presentation-guidance>A visual presentation is required for this request.${kinds ? ` Prefer these generic visual kinds when appropriate: ${kinds}.` : ""} ${policy.presentation.reason ?? ""}</presentation-guidance>`;
  }
  if (policy.presentation.level === "preferred") {
    return `${message}\n\n<presentation-guidance>Prefer a useful visual over a dense text-only answer.${kinds ? ` Suitable generic visual kinds: ${kinds}.` : ""} ${policy.presentation.reason ?? ""} Use concise text alone only when a visual would not improve comprehension.</presentation-guidance>`;
  }
  return `${message}\n\n<presentation-guidance>Lead with concise text for a simple fact, but still use a generic visual when it would materially improve scanning, comparison, sequence, or spatial understanding.</presentation-guidance>`;
}

export function multimodalPrompt(message: string, photo?: { attachment: PhotoAttachment; image: Buffer }): string | AsyncIterable<SDKUserMessage> {
  if (!photo) return message;
  return (async function* (): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: photo.attachment.mimeType, data: photo.image.toString("base64") }
          },
          {
            type: "text",
            text: `<user-photo asset-id="upload:${photo.attachment.id}">This is the user's normalized uploaded photo. Treat it as visual context, not manual evidence.</user-photo>\n${message}`
          }
        ]
      },
      parent_tool_use_id: null
    };
  })();
}

type AttemptResult = {
  events: AgentEvent[];
  text: string;
  calledTools: Set<string>;
  sessionId?: string;
  costUsd?: number;
  apiDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  sdkTurns: number;
  toolCalls: number;
  toolErrors: number;
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
    mcpServers: { "knowledge-runtime": mcpServer },
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
  toolContext,
  photo
}: {
  prompt: string;
  resume?: string;
  repair: boolean;
  emit: EmitEvent;
  abortController: AbortController;
  model: string;
  queryAgent: typeof query;
  toolContext: ManualToolContext;
  photo?: { attachment: PhotoAttachment; image: Buffer };
}): Promise<AttemptResult> {
  const events: AgentEvent[] = [];
  const calledTools = new Set<string>();
  let toolCalls = 0;
  let toolErrors = 0;
  const attemptEmit: EmitEvent = async (event) => {
    if (event.type === "tool_start") {
      calledTools.add(event.name);
      toolCalls += 1;
    }
    if (event.type === "tool_end" && !event.ok) toolErrors += 1;
    if (isBufferedContent(event)) events.push(event);
    else await emit(event);
  };
  const mcpServer = createManualTools(attemptEmit, toolContext);
  let streamedText = "";
  let resultText = "";
  let finalSessionId = resume;
  let costUsd: number | undefined;
  let apiDurationMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let cacheCreationInputTokens = 0;
  let sdkTurns = 0;

  const response = queryAgent({
    prompt: multimodalPrompt(prompt, photo),
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
        apiDurationMs = sdkMessage.duration_api_ms ?? 0;
        sdkTurns = sdkMessage.num_turns ?? 0;
        for (const usage of Object.values(sdkMessage.modelUsage ?? {})) {
          inputTokens += usage.inputTokens ?? 0;
          outputTokens += usage.outputTokens ?? 0;
          cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
          cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
        }
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
      costUsd,
      apiDurationMs,
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      sdkTurns,
      toolCalls,
      toolErrors
    };
  } finally {
    response.close();
  }
}

export async function runAgentTurn({ message, sessionId, conversationContext, photo, emit, signal, queryAgent = query }: AgentTurnInput) {
  const turnStartedAt = Date.now();
  const policy = getTurnPolicy(message, { hasPhoto: Boolean(photo) });
  const uploadedPhoto = photo ? await getUploadedPhoto(photo.id) : undefined;
  const toolContext: ManualToolContext = {
    originalQuestion: message,
    process: processFromMessage(message),
    inputVoltage: inputVoltageFromMessage(message),
    amps: ampsFromMessage(message),
    photoAssetId: photo ? `upload:${photo.id}` : undefined,
    annotationPreviewState: { attempts: 0, approvedHashes: new Set<string>() }
  };
  const abortController = new AbortController();
  signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  const model = process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6";
  const firstAttempt = await runAttempt({
    prompt: promptWithPresentationGuidance(promptWithConversationContext(message, conversationContext), policy),
    resume: sessionId,
    repair: false,
    emit,
    abortController,
    model,
    queryAgent,
    toolContext,
    photo: uploadedPhoto
  });
  const cumulativeTools = new Set(firstAttempt.calledTools);
  let finalAttempt = firstAttempt;
  const firstValidationIssues = validateAgentResponse(policy, {
    text: firstAttempt.text,
    events: firstAttempt.events,
    calledTools: cumulativeTools
  });
  const initialValidationIssueCount = firstValidationIssues.length;
  let validationIssues = firstValidationIssues;
  let repaired = false;
  let totalCost = firstAttempt.costUsd;
  let apiDurationMs = firstAttempt.apiDurationMs;
  let inputTokens = firstAttempt.inputTokens;
  let outputTokens = firstAttempt.outputTokens;
  let cacheReadInputTokens = firstAttempt.cacheReadInputTokens;
  let cacheCreationInputTokens = firstAttempt.cacheCreationInputTokens;
  let sdkTurns = firstAttempt.sdkTurns;
  let toolCalls = firstAttempt.toolCalls;
  let toolErrors = firstAttempt.toolErrors;

  if (validationIssues.length > 0 && !abortController.signal.aborted) {
    repaired = true;
    const repairAttempt = await runAttempt({
      prompt: promptWithPresentationGuidance(makeRepairPrompt(message, validationIssues), policy),
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
    apiDurationMs += repairAttempt.apiDurationMs;
    inputTokens += repairAttempt.inputTokens;
    outputTokens += repairAttempt.outputTokens;
    cacheReadInputTokens += repairAttempt.cacheReadInputTokens;
    cacheCreationInputTokens += repairAttempt.cacheCreationInputTokens;
    sdkTurns += repairAttempt.sdkTurns;
    toolCalls += repairAttempt.toolCalls;
    toolErrors += repairAttempt.toolErrors;
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
  const metrics: TurnMetrics = {
    status: validationIssues.length > 0 ? "degraded" : "success",
    model,
    costUsd: totalCost ?? 0,
    durationMs: Date.now() - turnStartedAt,
    apiDurationMs,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    sdkTurns,
    toolCalls,
    toolErrors,
    repaired,
    validationIssues: initialValidationIssueCount + (repaired ? validationIssues.length : 0)
  };
  await emit({ type: "done", sessionId: finalAttempt.sessionId, costUsd: totalCost, metrics });

  return {
    sessionId: finalAttempt.sessionId,
    costUsd: totalCost,
    repaired,
    validationIssues,
    metrics
  };
}
