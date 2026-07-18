import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AnnotatedImageSchema, VisualAssetIdSchema, VisualSpecSchema } from "./visual-spec.js";
import { buildAnnotationPreview, buildVisualPayload, resolveVisualAsset, visualSpecHash } from "./visuals.js";
import {
  getFigure,
  getPage,
  getSettingsGuide,
  getSpecs,
  listFigures,
  lookupDutyCycle,
  lookupPolarity,
  lookupTroubleshooting,
  searchManual,
  searchParts
} from "./knowledge.js";
import type { EmitEvent, Process, WidgetPayload } from "./types.js";

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

type WidgetArgs = {
  name: WidgetPayload["name"];
  process?: string;
  inputVoltage?: 120 | 240;
  amps?: number;
  symptom?: string;
};

export type ManualToolContext = {
  originalQuestion: string;
  process?: Process;
  inputVoltage?: 120 | 240;
  amps?: number;
};

export function resolveToolArgument<T>(requested: T | undefined, userContext: T | undefined): T | undefined {
  return userContext ?? requested;
}

export function buildWidget(args: WidgetArgs, cachedData?: unknown): WidgetPayload {
  const { name, process, inputVoltage, amps, symptom } = args;
  if (cachedData !== undefined) {
    const title = ({
      duty_cycle: "Rated duty cycle",
      polarity: "Cable hookup",
      troubleshooting: "Diagnostic checklist",
      settings_guide: "Setup guide"
    } as const)[name];
    return { name, title, data: cachedData };
  }
  if (name === "duty_cycle") {
    if (!process || !inputVoltage || !amps) throw new Error("Duty-cycle widget requires process, inputVoltage, and amps.");
    return { name, title: "Rated duty cycle", data: lookupDutyCycle(process, inputVoltage, amps) };
  }
  if (name === "polarity") {
    if (!process) throw new Error("Polarity widget requires process.");
    return { name, title: "Cable hookup", data: lookupPolarity(process) };
  }
  if (name === "troubleshooting") {
    if (!symptom) throw new Error("Troubleshooting widget requires a symptom.");
    return { name, title: "Diagnostic checklist", data: lookupTroubleshooting(symptom, process) };
  }
  if (!process) throw new Error("Settings guide requires process.");
  return { name, title: "Setup guide", data: getSettingsGuide(process) };
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function displayName(toolName: string): string {
  return ({
    request_clarification: "Asking one setup question",
    search_manual: "Searching the manuals",
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
    show_widget: "Building an interactive guide",
    render_visual: "Drawing a source-grounded visual",
    render_artifact: "Rendering an interactive explanation"
  } as Record<string, string>)[toolName] ?? toolName;
}

export function createManualTools(emit: EmitEvent, context: ManualToolContext = { originalQuestion: "" }) {
  const lookupCache = new Map<WidgetPayload["name"], unknown>();
  const previewedAnnotations = new Set<string>();

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
      "search_manual",
      "Search all supplied OmniPro 220 manual text and visual metadata. Use this for procedures, terminology, and finding relevant source pages or figure ids.",
      { query: z.string().min(2).max(300), limit: z.number().int().min(1).max(10).optional() },
      instrument("search_manual", async ({ query, limit }) => jsonResult(searchManual(query, limit ?? 6))),
      { alwaysLoad: true }
    ),
    tool(
      "read_manual_pages",
      "Read up to two exact PDF pages as both extracted text and page pixels. Use when a visual/table needs verification or search snippets are insufficient. Source is owner-manual, quick-start, or selection-chart.",
      {
        pages: z.array(z.object({ source: z.enum(["owner-manual", "quick-start", "selection-chart"]), page: z.number().int().positive() })).min(1).max(2)
      },
      instrument("read_manual_pages", async ({ pages }) => {
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
      "List the curated manual figure catalog and ids. Prefer search_manual first; use this only when choosing among visuals.",
      {},
      instrument("list_figures", async () => jsonResult(listFigures()))
    ),
    tool(
      "inspect_visual_source",
      "Inspect the exact prepared pixels and dimensions for an approved visual before annotating it. Asset ids are figure:<figure-id> or page:<source>:<page>. Use absolute pixel coordinates relative to this exact trimmed and pre-sized image; do not use normalized coordinates.",
      { assetId: VisualAssetIdSchema },
      instrument("inspect_visual_source", async ({ assetId }) => {
        const prepared = await resolveVisualAsset(assetId);
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
      "Validate and preview an annotated-image spec before displaying it. Use absolute pixel coordinates from inspect_visual_source. Review the returned image: each numbered mark must visibly touch the intended target. If it is wrong, revise and preview again. This tool rejects out-of-bounds and blank-background targets.",
      { spec: AnnotatedImageSchema },
      instrument("preview_visual_annotations", async ({ spec }) => {
        const result = await buildAnnotationPreview(spec);
        previewedAnnotations.add(result.hash);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ previewed: true, visualHash: result.hash, width: result.prepared.asset.width, height: result.prepared.asset.height, instruction: "Confirm every marker points to the named physical target. Only then call render_visual with the exact same spec." }, null, 2) },
            { type: "image" as const, data: result.preview.toString("base64"), mimeType: "image/png" }
          ]
        } as ReturnType<typeof jsonResult>;
      }),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_duty_cycle",
      "Return certified duty-cycle points for a process, input voltage, and amperage. It never interpolates unpublished values. Flux-cored uses the manual's MIG/wire power ratings.",
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
        lookupCache.set("duty_cycle", data);
        return jsonResult(data);
      }),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_polarity",
      "Return exact socket routing, polarity, gas, and source pages for MIG, self-shielded flux-cored, TIG, or stick.",
      { process: z.string().describe(PROCESS_DESCRIPTION) },
      instrument("lookup_polarity", async ({ process }) => {
        const data = lookupPolarity(resolveToolArgument(process, context.process) ?? process);
        lookupCache.set("polarity", data);
        return jsonResult(data);
      }),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_troubleshooting",
      "Match a symptom against the manual troubleshooting matrix and visual weld-diagnosis guide.",
      { symptom: z.string().min(2).max(500), process: z.string().optional().describe(PROCESS_DESCRIPTION) },
      instrument("lookup_troubleshooting", async ({ symptom, process }) => {
        const data = lookupTroubleshooting(symptom, resolveToolArgument(process, context.process));
        lookupCache.set("troubleshooting", data);
        return jsonResult(data);
      })
    ),
    tool(
      "get_specs",
      "Get exact published machine specifications and current ranges, optionally for one process.",
      { process: z.string().optional().describe(PROCESS_DESCRIPTION) },
      instrument("get_specs", async ({ process }) => jsonResult(getSpecs(process)))
    ),
    tool(
      "get_settings_guide",
      "Get supported setup inputs and limits for a process. The manuals do not publish the synergic algorithm's full numeric outputs, and this tool says so explicitly.",
      { process: z.string().describe(PROCESS_DESCRIPTION) },
      instrument("get_settings_guide", async ({ process }) => {
        const data = getSettingsGuide(resolveToolArgument(process, context.process) ?? process);
        lookupCache.set("settings_guide", data);
        return jsonResult(data);
      })
    ),
    tool(
      "search_parts",
      "Search the numbered parts list by name or number and return assembly-diagram references.",
      { query: z.string().min(1).max(100) },
      instrument("search_parts", async ({ query }) => jsonResult(searchParts(query)))
    ),
    tool(
      "show_figure",
      "Display a real curated figure from the supplied manuals inline in chat. Use after search or lookup identifies a relevant figure id.",
      { id: z.string(), caption: z.string().max(300).optional() },
      instrument("show_figure", async ({ id, caption }) => {
        const figure = getFigure(id);
        await emit({
          type: "figure",
          figure: {
            id: figure.id,
            title: figure.title,
            caption: caption ?? figure.caption,
            url: `/knowledge/${figure.file}`,
            source: figure.source,
            pages: figure.pages
          }
        });
        return jsonResult({ displayed: true, figureId: id, instruction: "Do not repeat every label in prose; explain the important routing or visual evidence." });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "show_widget",
      "Display a certified deterministic calculator or checklist for duty cycle, troubleshooting, or settings guidance. For spatial relationships such as cable routing, compose a dynamic connection-diagram with render_visual instead.",
      {
        name: z.enum(["duty_cycle", "troubleshooting", "settings_guide"]),
        process: z.string().optional().describe(PROCESS_DESCRIPTION),
        inputVoltage: z.union([z.literal(120), z.literal(240)]).optional(),
        amps: z.number().positive().optional(),
        symptom: z.string().max(500).optional()
      },
      instrument("show_widget", async ({ name, process, inputVoltage, amps, symptom }) => {
        const widget = buildWidget({
          name,
          process: resolveToolArgument(process, context.process),
          inputVoltage: resolveToolArgument(inputVoltage, context.inputVoltage),
          amps: resolveToolArgument(amps, context.amps),
          symptom
        }, lookupCache.get(name));
        await emit({ type: "widget", widget });
        return jsonResult({ displayed: true, widget: name });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "render_visual",
      "Render a dynamic, source-grounded visual from semantic JSON. This is the generic presentation tool: use connection-diagram for relationships and cable/flow routing, annotated-image to explain a figure or page after inspecting it, procedure for ordered physical actions, or comparison for side-by-side choices. Image asset ids must be figure:<figure-id> or page:<source>:<page>. Do not invent facts to fill a visual.",
      { spec: VisualSpecSchema },
      instrument("render_visual", async ({ spec }) => {
        if (spec.kind === "annotated-image" && !previewedAnnotations.has(visualSpecHash(spec))) {
          throw new Error("Annotated images must be validated with preview_visual_annotations using the exact same spec before display.");
        }
        const visual = await buildVisualPayload(randomUUID(), spec);
        await emit({ type: "visual", visual });
        return jsonResult({ displayed: true, visualId: visual.id, kind: visual.spec.kind });
      }),
      { alwaysLoad: true }
    ),
    tool(
      "render_artifact",
      "Display a novel interactive single-file HTML explanation when a prebuilt widget cannot express an important multi-step relationship. Inline CSS/JS only; no external URLs, images, fonts, forms, storage, or network calls.",
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

  return createSdkMcpServer({
    name: "omnipro-manual",
    version: "1.0.0",
    instructions: "Use these tools as the only authority for Vulcan OmniPro 220 facts. Presentation tools render into the user's chat.",
    tools
  });
}

export const MANUAL_TOOL_NAMES = [
  "request_clarification",
  "search_manual",
  "read_manual_pages",
  "list_figures",
  "inspect_visual_source",
  "preview_visual_annotations",
  "lookup_duty_cycle",
  "lookup_polarity",
  "lookup_troubleshooting",
  "get_specs",
  "get_settings_guide",
  "search_parts",
  "show_figure",
  "show_widget",
  "render_visual",
  "render_artifact"
].map((name) => `mcp__omnipro-manual__${name}`);
