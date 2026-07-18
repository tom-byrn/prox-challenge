import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
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
import type { EmitEvent, WidgetPayload } from "./types.js";

const PROCESS_DESCRIPTION = "MIG, self-shielded flux-cored, TIG, or stick";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function displayName(toolName: string): string {
  return ({
    search_manual: "Searching the manuals",
    read_manual_pages: "Reading source pages",
    list_figures: "Checking the figure library",
    lookup_duty_cycle: "Checking rated duty cycle",
    lookup_polarity: "Tracing cable polarity",
    lookup_troubleshooting: "Checking the diagnostic matrix",
    get_specs: "Reading machine specifications",
    get_settings_guide: "Checking setup guidance",
    search_parts: "Searching the parts list",
    show_figure: "Opening a manual figure",
    show_widget: "Building an interactive guide",
    render_artifact: "Rendering an interactive explanation"
  } as Record<string, string>)[toolName] ?? toolName;
}

export function createManualTools(emit: EmitEvent) {
  function instrument<T extends Record<string, unknown>>(
    name: string,
    handler: (args: T) => Promise<ReturnType<typeof jsonResult>> | ReturnType<typeof jsonResult>
  ) {
    return async (args: T) => {
      const id = randomUUID();
      await emit({ type: "tool_start", id, name, label: displayName(name) });
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
      "lookup_duty_cycle",
      "Return certified duty-cycle points for a process, input voltage, and amperage. It never interpolates unpublished values. Flux-cored uses the manual's MIG/wire power ratings.",
      {
        process: z.string().describe(PROCESS_DESCRIPTION),
        inputVoltage: z.union([z.literal(120), z.literal(240)]),
        amps: z.number().positive()
      },
      instrument("lookup_duty_cycle", async ({ process, inputVoltage, amps }) => jsonResult(lookupDutyCycle(process, inputVoltage, amps))),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_polarity",
      "Return exact socket routing, polarity, gas, and source pages for MIG, self-shielded flux-cored, TIG, or stick.",
      { process: z.string().describe(PROCESS_DESCRIPTION) },
      instrument("lookup_polarity", async ({ process }) => jsonResult(lookupPolarity(process))),
      { alwaysLoad: true }
    ),
    tool(
      "lookup_troubleshooting",
      "Match a symptom against the manual troubleshooting matrix and visual weld-diagnosis guide.",
      { symptom: z.string().min(2).max(500), process: z.string().optional().describe(PROCESS_DESCRIPTION) },
      instrument("lookup_troubleshooting", async ({ symptom, process }) => jsonResult(lookupTroubleshooting(symptom, process)))
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
      instrument("get_settings_guide", async ({ process }) => jsonResult(getSettingsGuide(process)))
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
      "Display a deterministic interactive widget. Use duty_cycle for rated output, polarity for hookup, troubleshooting for symptoms, or settings_guide for machine setup inputs.",
      {
        name: z.enum(["duty_cycle", "polarity", "troubleshooting", "settings_guide"]),
        process: z.string().optional().describe(PROCESS_DESCRIPTION),
        inputVoltage: z.union([z.literal(120), z.literal(240)]).optional(),
        amps: z.number().positive().optional(),
        symptom: z.string().max(500).optional()
      },
      instrument("show_widget", async ({ name, process, inputVoltage, amps, symptom }) => {
        let widget: WidgetPayload;
        if (name === "duty_cycle") {
          if (!process || !inputVoltage || !amps) throw new Error("Duty-cycle widget requires process, inputVoltage, and amps.");
          widget = { name, title: "Rated duty cycle", data: lookupDutyCycle(process, inputVoltage, amps) };
        } else if (name === "polarity") {
          if (!process) throw new Error("Polarity widget requires process.");
          widget = { name, title: "Cable hookup", data: lookupPolarity(process) };
        } else if (name === "troubleshooting") {
          if (!symptom) throw new Error("Troubleshooting widget requires a symptom.");
          widget = { name, title: "Diagnostic checklist", data: lookupTroubleshooting(symptom, process) };
        } else {
          if (!process) throw new Error("Settings guide requires process.");
          widget = { name, title: "Setup guide", data: getSettingsGuide(process) };
        }
        await emit({ type: "widget", widget });
        return jsonResult({ displayed: true, widget: name });
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
  "search_manual",
  "read_manual_pages",
  "list_figures",
  "lookup_duty_cycle",
  "lookup_polarity",
  "lookup_troubleshooting",
  "get_specs",
  "get_settings_guide",
  "search_parts",
  "show_figure",
  "show_widget",
  "render_artifact"
].map((name) => `mcp__omnipro-manual__${name}`);
