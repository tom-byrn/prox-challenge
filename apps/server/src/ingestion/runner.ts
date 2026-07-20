import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { INGESTION_SYSTEM_PROMPT, repairPrompt, stagePrompt } from "./prompt.js";
import { createIngestionTools, ingestionToolNamesForStage } from "./tools.js";
import type { IngestionCheckpoint, IngestionTelemetryEvent, IngestionWorkspace, PreparedSources, StageName } from "./types.js";

export type StageBudget = { maxTurns: number; maxBudgetUsd: number };

export type StageRunResult = {
  stage: StageName;
  attempts: number;
  sessionId?: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  sdkTurns: number;
  toolCalls: number;
  failures: number;
  durationMs: number;
  checkpoint: IngestionCheckpoint;
  telemetry: IngestionTelemetryEvent[];
};

type QueryFunction = typeof query;

type Attempt = {
  sessionId?: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  sdkTurns: number;
  resultError?: string;
};

function usageFromMessage(message: SDKMessage): Pick<Attempt, "costUsd" | "inputTokens" | "outputTokens" | "sdkTurns"> {
  if (message.type !== "result") return { costUsd: 0, inputTokens: 0, outputTokens: 0, sdkTurns: 0 };
  let inputTokens = 0;
  let outputTokens = 0;
  for (const usage of Object.values(message.modelUsage ?? {})) {
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
  }
  return { costUsd: message.total_cost_usd ?? 0, inputTokens, outputTokens, sdkTurns: message.num_turns ?? 0 };
}

async function consumeAttempt(response: ReturnType<QueryFunction>, previousSession?: string): Promise<Attempt> {
  let result: Attempt = { sessionId: previousSession, costUsd: 0, inputTokens: 0, outputTokens: 0, sdkTurns: 0 };
  try {
    for await (const message of response) {
      if (message.session_id) result.sessionId = message.session_id;
      if (message.type === "result") {
        result = { ...result, ...usageFromMessage(message) };
        if (message.subtype !== "success") result.resultError = message.errors.join(" ") || `Agent result was ${message.subtype}.`;
      }
    }
  } finally {
    response.close();
  }
  return result;
}

function requiredCompletionIssues(stage: StageName, checkpoint: IngestionCheckpoint, sources: PreparedSources, telemetry: IngestionTelemetryEvent[], sourceId?: string): string[] {
  const successfulTools = new Set(telemetry.filter((event) => event.success).map((event) => event.tool));
  if (stage === "sections") {
    const missing = sources.documents.filter((document) => (!sourceId || document.id === sourceId) && !checkpoint.documentTitles[document.id]).map((document) => document.id);
    return missing.length ? [`save_sections was not successfully completed for: ${missing.join(", ")}.`] : [];
  }
  if (stage === "figures") {
    if (!successfulTools.has("inspect_page_image")) return ["Figure review must inspect source pixels even when no useful figure is accepted."];
    return [];
  }
  if (stage === "datasets") return [];
  if (stage === "video") {
    const missing = sources.videos.filter((video) => (!sourceId || video.id === sourceId) && !checkpoint.videoSegments.some((segment) => segment.videoId === video.id)).map((video) => video.id);
    return missing.length ? [`save_video_segments was not successfully completed for: ${missing.join(", ")}.`] : [];
  }
  return checkpoint.ready && successfulTools.has("finalize_ingestion") ? [] : ["finalize_ingestion did not report ready=true."];
}

export async function runIngestionStage({
  stage,
  sources,
  workspace,
  checkpoint,
  sourceId,
  queryAgent = query,
  model = process.env.CLAUDE_INGESTION_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6",
  budget = {
    maxTurns: Number(process.env.CLAUDE_INGESTION_MAX_TURNS) || 24,
    maxBudgetUsd: Number(process.env.CLAUDE_INGESTION_MAX_BUDGET_USD) || 1.5
  },
  signal
}: {
  stage: StageName;
  sources: PreparedSources;
  workspace: IngestionWorkspace;
  checkpoint: IngestionCheckpoint;
  sourceId?: string;
  queryAgent?: QueryFunction;
  model?: string;
  budget?: StageBudget;
  signal?: AbortSignal;
}): Promise<StageRunResult> {
  const startedAt = Date.now();
  const telemetry: IngestionTelemetryEvent[] = [];
  const tools = createIngestionTools({
    stage,
    reader: new (await import("./source-reader.js")).IngestionSourceReader(workspace.preparedDir, sources.documents, sources.videos),
    workspace,
    runId: workspace.runId,
    sourceId,
    checkpoint,
    onTelemetry: (event) => {
      telemetry.push(event);
      process.stdout.write(`[${event.stage}] ${event.success ? "ok" : "error"} ${event.tool}${event.sourceIds.length ? ` (${event.sourceIds.join(",")})` : ""}${event.error ? `: ${event.error}` : ""}\n`);
    }
  });
  const abortController = new AbortController();
  signal?.addEventListener("abort", () => abortController.abort(), { once: true });
  let sessionId: string | undefined;
  let attempts = 0;
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sdkTurns = 0;
  let issues: string[] = [];
  const wallClockMs = Number(process.env.CLAUDE_INGESTION_STAGE_TIMEOUT_MS) || 10 * 60_000;
  const deadline = setTimeout(() => abortController.abort(), wallClockMs);
  deadline.unref();

  try {
    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    attempts += 1;
    const before = telemetry.length;
    const prompt = attemptIndex === 0 ? stagePrompt(stage, sources, sourceId) : repairPrompt(stage, issues);
    const response = queryAgent({
      prompt,
      options: {
        abortController,
        cwd: process.cwd(),
        model,
        systemPrompt: INGESTION_SYSTEM_PROMPT,
        tools: [] as string[],
        allowedTools: ingestionToolNamesForStage(stage),
        mcpServers: { "knowledge-ingestion": tools.server },
        strictMcpConfig: true,
        settingSources: [],
        permissionMode: "dontAsk",
        includePartialMessages: false,
        maxTurns: attemptIndex === 0 ? budget.maxTurns : Math.min(10, budget.maxTurns),
        maxBudgetUsd: attemptIndex === 0 ? budget.maxBudgetUsd : Math.min(0.5, budget.maxBudgetUsd),
        effort: "medium",
        resume: sessionId,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "prox-ingestion/1.0.0" }
      }
    });
    let attempt: Attempt;
    try {
      attempt = await consumeAttempt(response, sessionId);
    } catch (error) {
      issues = [error instanceof Error ? error.message : String(error)];
      if (attemptIndex === 0) continue;
      throw new Error(`${stage} stage failed after one transport retry: ${issues.join(" ")}`);
    }
    sessionId = attempt.sessionId;
    costUsd += attempt.costUsd;
    inputTokens += attempt.inputTokens;
    outputTokens += attempt.outputTokens;
    sdkTurns += attempt.sdkTurns;
    issues = [
      ...(attempt.resultError ? [attempt.resultError] : []),
      ...requiredCompletionIssues(stage, tools.controller.checkpoint, sources, telemetry.slice(before), sourceId)
    ];
    if (issues.length === 0) break;
    }

    if (issues.length > 0) throw new Error(`${stage} stage failed after one repair attempt: ${issues.join(" ")}`);
    return {
      stage,
      attempts,
      sessionId,
      model,
      costUsd,
      inputTokens,
      outputTokens,
      sdkTurns,
      toolCalls: telemetry.length,
      failures: telemetry.filter((event) => !event.success).length,
      durationMs: Date.now() - startedAt,
      checkpoint: tools.controller.checkpoint,
      telemetry
    };
  } finally {
    clearTimeout(deadline);
  }
}
