import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DocumentSourceIdSchema, EvidenceRefSchema, type EvidenceRef } from "./evidence.js";
import { AnnotatedImageSchema, VisualAssetIdSchema, VisualSpecSchema } from "./visual-spec.js";
import { buildAnnotationPreview, buildVisualPayload, resolveVisualAsset, visualSpecHash } from "./visuals.js";
import {
  getFigure,
  getKnowledgeAssetUrl,
  getKnowledgeProductInfo,
  getPage,
  getSettingsGuide,
  getSpecs,
  listFigures,
  lookupDutyCycle,
  lookupPolarity,
  lookupTroubleshooting,
  resolveEvidenceRefs,
  searchSources,
  searchParts
} from "./knowledge.js";
import type { EmitEvent, Process } from "./types.js";

const PROCESS_DESCRIPTION = "MIG, self-shielded flux-cored, TIG, or stick";
const ClarificationOptionsSchema = z.array(z.object({
  id: z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(180).optional()
})).min(2).max(4).superRefine((options, validation) => {
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    validation.addIssue({ code: "custom", message: "Clarification option ids must be unique." });
  }
});

export type ManualToolContext = {
  originalQuestion: string;
  process?: Process;
  inputVoltage?: 120 | 240;
  amps?: number;
  photoAssetId?: string;
  annotationPreviewState?: { attempts: number; approvedHashes: Set<string> };
};

export function resolveToolArgument<T>(requested: T | undefined, userContext: T | undefined): T | undefined {
  return userContext ?? requested;
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function documentRef(sourceId: string, pages: number[]): EvidenceRef {
  return { kind: "document", sourceId, pages };
}

function structuredRef(
  dataset: string,
  recordIds: string[],
  pages: number[],
  sourceId: string = "owner-manual"
): EvidenceRef {
  return { kind: "structured-data", dataset, recordIds, sourceId, pages };
}

function displayName(toolName: string): string {
  return ({
    request_clarification: "Asking one setup question",
    search_sources: "Searching manuals and video",
    read_manual_pages: "Reading source pages",
    list_figures: "Checking the figure library",
    inspect_visual_source: "Inspecting a source image",
    preview_visual_annotations: "Checking annotation placement",
    lookup_duty_cycle: "Checking rated duty cycle",
    lookup_polarity: "Tracing cable polarity",
    lookup_troubleshooting: "Checking the diagnostic matrix",
    get_specs: "Reading machine specifications",
    get_settings_guide: "Checking setup guidance",
    search_parts: "Searching the parts list",
    show_figure: "Opening a manual figure",
    show_source: "Opening source evidence",
    render_visual: "Drawing a source-grounded visual",
    render_artifact: "Rendering an interactive explanation"
  } as Record<string, string>)[toolName] ?? toolName;
}

export function createManualTools(emit: EmitEvent, context: ManualToolContext = { originalQuestion: "" }) {
  const product = getKnowledgeProductInfo();
  const annotationPreviewState = context.annotationPreviewState ?? { attempts: 0, approvedHashes: new Set<string>() };
  const previewedAnnotations = annotationPreviewState.approvedHashes;

  async function emitEvidence(refs: EvidenceRef[]) {
    if (refs.length > 0) await emit({ type: "evidence", sources: resolveEvidenceRefs(refs) });
  }

  function instrument<T extends Record<string, unknown>>(
    name: string,
    handler: (args: T) => Promise<ReturnType<typeof jsonResult>> | ReturnType<typeof jsonResult>
  ) {
    return async (args: T) => {
      const id = randomUUID();
      await emit({ type: "tool_start", id, name, label: displayName(name), input: args });
      try {
        const result = await handler(args);
        await emit({ type: "tool_end", id, name, ok: true });
        return result;
      } catch (error) {
        await emit({ type: "tool_end", id, name, ok: false });
        throw error;
      }
    };
  }

  const tools = [
    tool(
      "request_clarification",
      "Ask one concise question when missing user context would materially change the answer. Supply 2–4 short, mutually exclusive likely choices and allow free-text re-explanation when useful. After calling this tool, end the turn without solving the original question; the user's selection will continue the same conversation.",
      {
        question: z.string().trim().min(3).max(220),
        options: ClarificationOptionsSchema,
        allowOther: z.boolean()
      },
      instrument("request_clarification", async ({ question, options, allowOther }) => {
        const clarification = { id: randomUUID(), originalQuestion: context.originalQuestion, question, options, allowOther };
        await emit({ type: "clarification_request", clarification });
        return jsonResult({ displayed: true, clarificationId: clarification.id, instruction: "End this turn now. Wait for the user's selection or explanation before answering." });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "search_sources",
      `Search the registered ${product.name} documents, generated figures, verified dataset records, and timestamped video transcripts. Respect each source's manifest authority; videos are supplemental demonstrations.`,
      { query: z.string().min(2).max(300), limit: z.number().int().min(1).max(10).optional() },
      instrument("search_sources", async ({ query, limit }) => {
        const result = searchSources(query, limit ?? 6);
        await emitEvidence([
          ...result.documents.map((item) => item.ref),
          ...result.figures.map((item) => item.ref),
          ...result.videos.map((item) => item.ref),
          ...result.datasets.map((item) => item.ref)
        ].slice(0, 10));
        return jsonResult(result);
      }),
      { alwaysLoad: true }
    ),
    tool(
      "read_manual_pages",
      "Read up to two exact registered PDF pages as both extracted text and page pixels. Use when a visual/table needs verification or search snippets are insufficient.",
      {
        pages: z.array(z.object({ source: DocumentSourceIdSchema, page: z.number().int().positive() })).min(1).max(2)
      },
      instrument("read_manual_pages", async ({ pages }) => {
        await emitEvidence(pages.map((request) => documentRef(request.source, [request.page])));
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
        for (const request of pages) {
          const page = getPage(request.source, request.page);
          content.push({ type: "text", text: `SOURCE: ${page.source}, page ${page.page}\n${page.text}` });
          content.push({ type: "image", data: (await readFile(page.imagePath)).toString("base64"), mimeType: "image/png" });
        }
        return { content } as ReturnType<typeof jsonResult>;
      }),
      { alwaysLoad: true }
    ),
    tool(
      "list_figures",
      "List the curated manual figure catalog and ids. Prefer search_sources first; use this only when choosing among visuals.",
      {},
      instrument("list_figures", async () => jsonResult(listFigures()))
    ),
    tool(
      "inspect_visual_source",
      "Inspect the exact prepared pixels and dimensions for an approved visual before annotating it. Asset ids are figure:<figure-id>, page:<source>:<page>, or the upload:<photo-id> explicitly supplied in the current user message. Use absolute pixel coordinates relative to this exact prepared image; do not use normalized coordinates.",
      { assetId: VisualAssetIdSchema },
      instrument("inspect_visual_source", async ({ assetId }) => {
        const prepared = await resolveVisualAsset(assetId, context.photoAssetId);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ ...prepared.asset, coordinateSystem: `absolute pixels: origin (0,0) at top-left; x 0–${prepared.asset.width}; y 0–${prepared.asset.height}` }, null, 2) },
            { type: "image" as const, data: prepared.image.toString("base64"), mimeType: "image/png" }
          ]
        } as ReturnType<typeof jsonResult>;
      }),
      { alwaysLoad: true }
    ),
    tool(
      "preview_visual_annotations",
      "Preview and validate an annotated-image spec before displaying it. The tool always returns the numbered overlay with a temporary absolute-pixel coordinate grid, including when a marker is invalid, so use that image—not blind coordinate nudges—to revise only the named invalid annotations. A preview is approved for render_visual only when valid is true. At most four previews are allowed per turn.",
      { spec: AnnotatedImageSchema },
      instrument("preview_visual_annotations", async ({ spec }) => {
        annotationPreviewState.attempts += 1;
        if (annotationPreviewState.attempts > 4) {
          return jsonResult({
            valid: false,
            attemptLimitReached: true,
            instruction: "Stop revising coordinates. Do not narrate the failed attempts. Use an already approved spec if one exists; otherwise ask for a clearer photo or explain that a reliable overlay could not be produced."
          });
        }
        const result = await buildAnnotationPreview(spec, context.photoAssetId);
        if (result.valid) previewedAnnotations.add(result.hash);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                previewed: true,
                valid: result.valid,
                attempt: annotationPreviewState.attempts,
                attemptsRemaining: 4 - annotationPreviewState.attempts,
                visualHash: result.hash,
                width: result.prepared.asset.width,
                height: result.prepared.asset.height,
                issues: result.issues,
                instruction: result.valid
                  ? "Every marker passed placement checks. Call render_visual with this exact unchanged spec."
                  : "Review the returned numbered overlay. Revise only the annotations listed in issues, preserving markers that are already on target. Do not call render_visual until valid is true."
              }, null, 2)
            },
            { type: "image" as const, data: result.preview.toString("base64"), mimeType: "image/png" }
          ]
        } as ReturnType<typeof jsonResult>;
      }),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_duty_cycle",
      "Return exact published duty-cycle points for a process, input voltage, and amperage. It never interpolates unpublished values. Flux-cored uses the manual's MIG/wire power ratings. Prefer presenting multi-value results with render_visual metric-summary.",
      {
        process: z.string().describe(PROCESS_DESCRIPTION),
        inputVoltage: z.union([z.literal(120), z.literal(240)]),
        amps: z.number().positive()
      },
      instrument("lookup_duty_cycle", async ({ process, inputVoltage, amps }) => {
        const data = lookupDutyCycle(
          resolveToolArgument(process, context.process) ?? process,
          resolveToolArgument(inputVoltage, context.inputVoltage) ?? inputVoltage,
          resolveToolArgument(amps, context.amps) ?? amps
        );
        const ratings = data.exact && data.rating ? [data.rating] : (data.nearestPublishedRatings ?? []);
        const pages = [...new Set(ratings.flatMap((rating) => rating.pages))];
        if (ratings.length > 0 && pages.length > 0) {
          await emitEvidence([
            structuredRef("duty-cycles", ratings.map((rating) => `${rating.process}:${rating.inputVoltage}:${rating.amps}`), pages),
            documentRef("owner-manual", pages)
          ]);
        }
        return jsonResult(data);
      }),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_polarity",
      "Return exact socket routing, polarity, gas, and source pages for MIG, self-shielded flux-cored, TIG, or stick. Present routing with a render_visual connection-diagram when it improves clarity.",
      { process: z.string().describe(PROCESS_DESCRIPTION) },
      instrument("lookup_polarity", async ({ process }) => {
        const data = lookupPolarity(resolveToolArgument(process, context.process) ?? process);
        const pageGroups = data.pages as { ownerManual?: number[]; quickStart?: number[] };
        const ownerPages = pageGroups.ownerManual ?? [];
        const quickPages = pageGroups.quickStart ?? [];
        await emitEvidence([
          structuredRef("polarity-setups", [data.id], ownerPages),
          ...(ownerPages.length ? [documentRef("owner-manual", ownerPages)] : []),
          ...(quickPages.length ? [documentRef("quick-start", quickPages)] : [])
        ]);
        return jsonResult(data);
      }),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_troubleshooting",
      "Match a symptom against the manual troubleshooting matrix and visual weld-diagnosis guide. Prefer a render_visual procedure when several checks should be performed in order.",
      { symptom: z.string().min(2).max(500), process: z.string().optional().describe(PROCESS_DESCRIPTION) },
      instrument("lookup_troubleshooting", async ({ symptom, process }) => {
        const data = lookupTroubleshooting(symptom, resolveToolArgument(process, context.process));
        const pages = [...new Set(data.matches.flatMap((match) => match.pages))];
        if (pages.length > 0) {
          await emitEvidence([
            structuredRef("troubleshooting", data.matches.map((match) => match.id), pages),
            documentRef("owner-manual", pages)
          ]);
        }
        return jsonResult(data);
      })
    ),
    tool(
      "get_specs",
      "Get exact published machine specifications and current ranges, optionally for one process.",
      { process: z.string().optional().describe(PROCESS_DESCRIPTION) },
      instrument("get_specs", async ({ process }) => {
        const data = getSpecs(process) as Record<string, unknown>;
        const pages = Array.isArray(data.pages) ? data.pages.filter((page): page is number => typeof page === "number") : [7];
        await emitEvidence([structuredRef("specifications", [process ?? "all"], pages), documentRef("owner-manual", pages)]);
        return jsonResult(data);
      })
    ),
    tool(
      "get_settings_guide",
      "Get supported setup inputs and limits for a process. The manuals do not publish the synergic algorithm's full numeric outputs, and this tool says so explicitly. Prefer a render_visual reference-card for grouped setup facts.",
      { process: z.string().describe(PROCESS_DESCRIPTION) },
      instrument("get_settings_guide", async ({ process }) => {
        const data = getSettingsGuide(resolveToolArgument(process, context.process) ?? process);
        const pages = Array.isArray(data.pages) ? data.pages.filter((page): page is number => typeof page === "number") : [];
        await emitEvidence([structuredRef("settings-guide", [data.mode.process], pages), documentRef("owner-manual", pages)]);
        return jsonResult(data);
      })
    ),
    tool(
      "search_parts",
      "Search the numbered parts list by name or number and return assembly-diagram references.",
      { query: z.string().min(1).max(100) },
      instrument("search_parts", async ({ query }) => {
        const data = searchParts(query);
        const pages = [data.listPage, data.diagramPage];
        if (data.results.length > 0) {
          await emitEvidence([
            structuredRef("parts", data.results.map((part) => String(part.number)), pages),
            documentRef("owner-manual", pages)
          ]);
        }
        return jsonResult(data);
      })
    ),
    tool(
      "show_figure",
      "Display a real curated figure from the supplied manuals inline in chat. Use after search or lookup identifies a relevant figure id.",
      { id: z.string(), caption: z.string().max(300).optional() },
      instrument("show_figure", async ({ id, caption }) => {
        const figure = getFigure(id);
        await emitEvidence([{ kind: "figure", figureId: id }]);
        await emit({
          type: "figure",
          figure: {
            id: figure.id,
            title: figure.title,
            caption: caption ?? figure.caption,
            url: getKnowledgeAssetUrl(figure.file),
            source: figure.source,
            pages: figure.pages
          }
        });
        return jsonResult({ displayed: true, figureId: id, instruction: "Do not repeat every label in prose; explain the important routing or visual evidence." });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "show_source",
      "Surface one retrieved evidence reference in chat. A video reference renders its exact timestamped segment; a figure reference renders the source figure; document and structured-data references are added to the Sources drawer. This accepts the generic evidence refs returned by search_sources.",
      { ref: EvidenceRefSchema, caption: z.string().max(300).optional() },
      instrument("show_source", async ({ ref, caption }) => {
        const [source] = resolveEvidenceRefs([ref]);
        if (!source) throw new Error("The requested source could not be resolved.");
        await emit({ type: "evidence", sources: [source] });
        if (source.kind === "video") {
          await emit({ type: "video", video: { id: randomUUID(), source } });
          return jsonResult({ displayed: true, kind: source.kind, sourceId: source.id, startSeconds: source.startSeconds, endSeconds: source.endSeconds });
        }
        if (source.kind === "figure" && ref.kind === "figure") {
          const figure = getFigure(ref.figureId);
          await emit({
            type: "figure",
            figure: {
              id: figure.id,
              title: figure.title,
              caption: caption ?? figure.caption,
              url: getKnowledgeAssetUrl(figure.file),
              source: figure.source,
              pages: figure.pages
            }
          });
        }
        return jsonResult({ displayed: source.kind === "figure", addedToSources: true, kind: source.kind, sourceId: source.id });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "render_visual",
      "Render a dynamic, source-grounded visual from semantic JSON. Use metric-summary for compact numeric facts, reference-card for grouped reference facts, connection-diagram for relationships and routing, annotated-image to explain an inspected figure/page/current upload, procedure for ordered actions, or comparison for side-by-side choices. Do not invent facts to fill a visual.",
      { spec: VisualSpecSchema },
      instrument("render_visual", async ({ spec }) => {
        if (spec.kind === "annotated-image" && !previewedAnnotations.has(visualSpecHash(spec))) {
          throw new Error("Annotated images must be validated with preview_visual_annotations using the exact same spec before display.");
        }
        await emitEvidence(spec.sourceRefs);
        const visual = await buildVisualPayload(randomUUID(), spec, context.photoAssetId);
        await emit({ type: "visual", visual });
        return jsonResult({ displayed: true, visualId: visual.id, kind: visual.spec.kind });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "render_artifact",
      "Display a novel interactive single-file HTML explanation when the generic visual language cannot express an important interaction. Inline CSS/JS only; no external URLs, images, fonts, forms, storage, or network calls.",
      { title: z.string().min(2).max(100), html: z.string().min(100).max(80_000) },
      instrument("render_artifact", async ({ title, html }) => {
        const forbidden = /<(?:iframe|object|embed|base)\b|https?:\/\/|fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage/iu;
        if (forbidden.test(html)) throw new Error("Artifact contains a forbidden network, embedding, or storage capability.");
        const id = randomUUID();
        await emit({ type: "artifact", artifact: { id, title, html } });
        return jsonResult({ displayed: true, artifactId: id });
      })
    )
  ];

  const specializedNames = new Set(["lookup_duty_cycle", "lookup_polarity", "lookup_troubleshooting", "get_specs", "get_settings_guide", "search_parts"]);
  const runtimeTools = product.hasOmniProAdapter ? tools : tools.filter((candidate) => !specializedNames.has(candidate.name));
  return createSdkMcpServer({
    name: "knowledge-runtime",
    version: "1.0.0",
    instructions: `Use these tools as the only authority for ${product.name} facts. Presentation tools render into the user's chat.`,
    tools: runtimeTools
  });
}

const GENERIC_TOOL_NAMES = [
  "request_clarification",
  "search_sources",
  "read_manual_pages",
  "list_figures",
  "inspect_visual_source",
  "preview_visual_annotations",
  "show_figure",
  "show_source",
  "render_visual",
  "render_artifact"
];
const OMNIPRO_TOOL_NAMES = ["lookup_duty_cycle", "lookup_polarity", "lookup_troubleshooting", "get_specs", "get_settings_guide", "search_parts"];
export const MANUAL_TOOL_NAMES = [...GENERIC_TOOL_NAMES, ...(getKnowledgeProductInfo().hasOmniProAdapter ? OMNIPRO_TOOL_NAMES : [])]
  .map((name) => `mcp__knowledge-runtime__${name}`);
