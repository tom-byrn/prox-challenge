#!/usr/bin/env node
import "dotenv/config";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { IngestionConfigSchema, IngestionRunSchema, PreparedDocumentSchema, PreparedVideoSchema, type IngestionConfig } from "../../apps/server/src/ingestion/schemas.js";
import { materializePackage } from "../../apps/server/src/ingestion/materialize.js";
import { runIngestionStage, type StageRunResult } from "../../apps/server/src/ingestion/runner.js";
import type { IngestionCheckpoint, PreparedSources, StageName } from "../../apps/server/src/ingestion/types.js";
import { atomicPromote, createIngestionWorkspace, existingIngestionWorkspace, registerSourceFile, REPOSITORY_ROOT, sourceIdFromPath, sourceIdFromUrl, writeJsonAtomic } from "../../apps/server/src/ingestion/workspace.js";
import { KnowledgeManifestSchema } from "../../apps/server/src/ingestion/schemas.js";
import { validatePackage } from "../../apps/server/src/ingestion/validate.js";

const execFileAsync = promisify(execFile);
const PYTHON = process.env.INGESTION_PYTHON?.trim() || "python3";

type CliOptions = {
  configPath?: string;
  productId?: string;
  productName?: string;
  inputs: string[];
  urls: string[];
  runId?: string;
  resumeRun?: string;
  prepareOnly: boolean;
  restartAnalysis: boolean;
};

function usage(): string {
  return `Usage:
  npm run ingest -- --product <id> [--product-name <name>] --input <file.pdf> [--input ...] [--url ...]
  npm run ingest -- --config <ingestion-config.json>

Options:
  --run-id <id>       Stable run id for testing/replay
  --resume-run <id>    Resume prepared/checkpointed staging after an interrupted run
  --restart-analysis   With --resume-run, discard semantic state but reuse prepared media
  --prepare-only      Stop after deterministic extraction (no API key required)
  --help              Show this message`;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { inputs: [], urls: [], prepareOnly: false, restartAnalysis: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (argument === "--prepare-only") {
      options.prepareOnly = true;
      continue;
    }
    if (argument === "--restart-analysis") {
      options.restartAnalysis = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    if (argument === "--config") options.configPath = value;
    else if (argument === "--product") options.productId = value;
    else if (argument === "--product-name") options.productName = value;
    else if (argument === "--input") options.inputs.push(value);
    else if (argument === "--url") options.urls.push(value);
    else if (argument === "--run-id") options.runId = value;
    else if (argument === "--resume-run") options.resumeRun = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function titleFromId(id: string): string {
  return id.split("-").map((word) => word ? `${word[0]?.toUpperCase()}${word.slice(1)}` : word).join(" ");
}

export function configFromOptions(options: CliOptions): IngestionConfig {
  if (options.configPath) {
    if (options.productId || options.inputs.length || options.urls.length) throw new Error("--config cannot be combined with --product, --input, or --url.");
    return IngestionConfigSchema.parse(JSON.parse(readFileSync(resolve(options.configPath), "utf8")));
  }
  if (!options.productId) throw new Error("--product is required when --config is not supplied.");
  return IngestionConfigSchema.parse({
    schemaVersion: 1,
    productId: options.productId,
    productName: options.productName ?? titleFromId(options.productId),
    documents: options.inputs.map((path) => ({ path, sourceId: sourceIdFromPath(path), authority: "authoritative-manual" })),
    videos: options.urls.map((url) => ({ url, sourceId: sourceIdFromUrl(url), authority: "supplemental-demonstration", captionLanguages: ["en"] }))
  });
}

async function prepareSources(config: IngestionConfig, workspace: ReturnType<typeof createIngestionWorkspace>): Promise<PreparedSources> {
  const documents = [];
  const videos = [];
  const documentMetadataPaths: string[] = [];
  const videoMetadataPaths: string[] = [];
  const ids = new Set<string>();
  for (const input of config.documents) {
    const sourceId = input.sourceId ?? sourceIdFromPath(input.path);
    if (ids.has(sourceId)) throw new Error(`Duplicate derived source id: ${sourceId}`);
    ids.add(sourceId);
    const registered = registerSourceFile(resolve(input.path), sourceId, workspace);
    const output = join(workspace.preparedDir, sourceId);
    const script = join(REPOSITORY_ROOT, "scripts", "ingest", "prepare-pdf.py");
    await execFileAsync(PYTHON, [script, "--input", registered, "--output", output, "--source-id", sourceId, "--authority", input.authority]);
    const metadataPath = join(output, "document.json");
    documents.push(PreparedDocumentSchema.parse(JSON.parse(readFileSync(metadataPath, "utf8"))));
    documentMetadataPaths.push(`${sourceId}/document.json`);
  }
  for (const input of config.videos) {
    const sourceId = input.sourceId ?? sourceIdFromUrl(input.url);
    if (ids.has(sourceId)) throw new Error(`Duplicate derived source id: ${sourceId}`);
    ids.add(sourceId);
    const output = join(workspace.preparedDir, sourceId);
    const script = join(REPOSITORY_ROOT, "scripts", "ingest", "prepare-video.py");
    const args = [script, "prepare", "--url", input.url, "--output", output, "--source-id", sourceId, "--authority", input.authority];
    for (const language of input.captionLanguages) args.push("--caption-language", language);
    await execFileAsync(PYTHON, args);
    const metadataPath = join(output, "video.json");
    videos.push(PreparedVideoSchema.parse(JSON.parse(readFileSync(metadataPath, "utf8"))));
    videoMetadataPaths.push(`${sourceId}/video.json`);
  }
  writeJsonAtomic(join(workspace.preparedDir, "sources.json"), { documents: documentMetadataPaths, videos: videoMetadataPaths });
  return { config, documents, videos };
}

function emptyCheckpoint(): IngestionCheckpoint {
  return { documentTitles: {}, sections: [], figures: [], datasets: [], videoSegments: [], ready: false };
}

function logStage(result: StageRunResult): void {
  process.stdout.write(`[${result.stage}] complete: attempts=${result.attempts} turns=${result.sdkTurns} tools=${result.toolCalls} cost=$${result.costUsd.toFixed(4)}\n`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  const config = configFromOptions(options);
  if (options.restartAnalysis && !options.resumeRun) throw new Error("--restart-analysis requires --resume-run.");
  if (options.runId && options.resumeRun) throw new Error("Use either --run-id or --resume-run, not both.");
  const workspace = options.resumeRun ? existingIngestionWorkspace(config.productId, options.resumeRun) : createIngestionWorkspace(config.productId, options.runId);
  let prepareDurationMs = 0;
  let sources: PreparedSources;
  if (options.resumeRun) {
    const savedConfig = IngestionConfigSchema.parse(JSON.parse(readFileSync(join(workspace.root, "config.json"), "utf8")));
    if (JSON.stringify(savedConfig) !== JSON.stringify(config)) throw new Error("Resume config does not match the staged run config.");
    const reader = (await import("../../apps/server/src/ingestion/source-reader.js")).IngestionSourceReader.load(workspace.preparedDir);
    sources = { config, documents: [...reader.documents.values()], videos: [...reader.videos.values()] };
    process.stdout.write(`Resuming prepared run in ${workspace.root}\n`);
  } else {
    process.stdout.write(`Preparing ${config.documents.length} document(s) and ${config.videos.length} video(s) in ${workspace.root}\n`);
    const prepareStartedAt = Date.now();
    sources = await prepareSources(config, workspace);
    prepareDurationMs = Date.now() - prepareStartedAt;
    writeJsonAtomic(join(workspace.root, "config.json"), config);
  }
  if (options.prepareOnly) {
    process.stdout.write(`Prepared sources successfully; staging retained at ${workspace.root}\n`);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is required after deterministic preparation. The previous finalized package was not changed.");

  let checkpoint = options.resumeRun && !options.restartAnalysis && existsSync(join(workspace.checkpointsDir, "state.json"))
    ? JSON.parse(readFileSync(join(workspace.checkpointsDir, "state.json"), "utf8")) as IngestionCheckpoint
    : emptyCheckpoint();
  const results: StageRunResult[] = [];
  const completedPath = join(workspace.checkpointsDir, "completed-stages.json");
  const completed = new Set<string>(options.resumeRun && !options.restartAnalysis && existsSync(completedPath)
    ? JSON.parse(readFileSync(completedPath, "utf8")) as string[]
    : []);
  if (options.resumeRun && !options.restartAnalysis) {
    for (const document of sources.documents) {
      if (checkpoint.documentTitles[document.id] && checkpoint.sections.some((section) => section.documentId === document.id)) completed.add(`sections:${document.id}`);
    }
  }
  const run = async (stage: StageName, sourceId?: string) => {
    const key = `${stage}:${sourceId ?? "*"}`;
    if (completed.has(key)) {
      const reused: StageRunResult = {
        stage,
        attempts: 1,
        model: process.env.CLAUDE_INGESTION_MODEL?.trim() || process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6",
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        sdkTurns: 0,
        toolCalls: 0,
        failures: 0,
        durationMs: 0,
        checkpoint,
        telemetry: []
      };
      results.push(reused);
      process.stdout.write(`[${stage}] reused valid checkpoint${sourceId ? ` for ${sourceId}` : ""}\n`);
      return;
    }
    const result = await runIngestionStage({ stage, sources, workspace, checkpoint, sourceId });
    checkpoint = result.checkpoint;
    results.push(result);
    completed.add(key);
    writeJsonAtomic(completedPath, [...completed].sort());
    logStage(result);
  };
  for (const document of sources.documents) await run("sections", document.id);
  for (const document of sources.documents) await run("figures", document.id);
  for (const document of sources.documents) await run("datasets", document.id);
  for (const video of sources.videos) await run("video", video.id);
  await run("finalize");

  const model = results.at(-1)?.model ?? process.env.CLAUDE_INGESTION_MODEL?.trim() ?? process.env.CLAUDE_MODEL?.trim() ?? "claude-sonnet-4-6";
  const runRecord = IngestionRunSchema.parse({
    id: workspace.runId,
    createdAt: new Date().toISOString(),
    model,
    promptVersion: "ingestion-v1",
    sourceHashes: Object.fromEntries([...sources.documents, ...sources.videos].map((source) => [source.id, source.sha256])),
    stages: [
      { name: "prepare", status: "complete", attempts: 1, durationMs: prepareDurationMs },
      ...results.map((result) => ({ name: result.stage, status: "complete", attempts: result.attempts, durationMs: result.durationMs, toolCalls: result.toolCalls, failures: result.failures }))
    ],
    costUsd: results.reduce((total, result) => total + result.costUsd, 0),
    inputTokens: results.reduce((total, result) => total + result.inputTokens, 0),
    outputTokens: results.reduce((total, result) => total + result.outputTokens, 0),
    sdkTurns: results.reduce((total, result) => total + result.sdkTurns, 0),
    validation: { valid: true, issues: [] }
  });
  writeJsonAtomic(join(workspace.root, "telemetry.json"), results.flatMap((result) => result.telemetry));
  await materializePackage({ sources, workspace, checkpoint, run: runRecord });
  await validatePackage(workspace.finalizedDir, Object.fromEntries(sources.documents.map((document) => [document.id, join(workspace.root, "sources", document.id, document.sourceFile)])));
  atomicPromote(workspace.finalizedDir, workspace.targetDir, (directory) => {
    const manifestPath = join(directory, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("Finalized package has no manifest.");
    KnowledgeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  });
  process.stdout.write(`Promoted valid package to ${workspace.targetDir}\n`);
}

if (basename(process.argv[1] ?? "") === "cli.ts") {
  runCli().catch((error) => {
    process.stderr.write(`Ingestion failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
