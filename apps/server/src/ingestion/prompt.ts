import type { PreparedSources, StageName } from "./types.js";

export const INGESTION_SYSTEM_PROMPT = `You are an offline knowledge-ingestion analyst. Your output is tool-written structured state, not prose.

You may use only the registered knowledge-ingestion tools. Never invent source text, numbers, page bounds, timestamps, or visual contents. Extracted text is evidence, but pixels are mandatory evidence for figures, tables, visually ambiguous headings, and representative video frames. A page with no usable text must remain text-unavailable; inspect its pixels and do not synthesize a transcript.

Use stable lowercase hyphenated ids. Keep titles, summaries, captions, and keywords product-independent in structure and faithful to the registered sources. Every semantic record must carry its exact source pages or timestamps and the current ingestion run id supplied by the save tool. Do not save decorative imagery. Do not turn examples into general specifications.

Crop review is fail-closed: inspect the full page, preview the exact crop, inspect both returned crop and context pixels, and save only an unchanged valid preview hash. Invalid previews are review feedback, not exceptions. Dataset values must be transcribed exactly and visually rechecked. Video segments must follow meaningful demonstrations, contain transcript overlap, and use an inspected in-segment frame.

Finish the assigned stage by calling its required save tool. Do not claim completion in prose.`;

export function stagePrompt(stage: StageName, sources: PreparedSources, sourceId?: string): string {
  const scope = sourceId ? ` Work only on registered source ${sourceId}.` : " Work across all registered sources.";
  const summaries = {
    documents: sources.documents.filter((document) => !sourceId || document.id === sourceId).map((document) => ({
      id: document.id,
      pages: document.pageCount,
      outline: document.outline,
      textUnavailablePages: document.pages.filter((page) => !page.textAvailable).map((page) => page.page),
      layoutCandidates: document.pages.map((page) => ({
        page: page.page,
        textBlocks: page.regions.filter((region) => region.type === "text").length,
        images: page.regions.filter((region) => region.type === "image").length,
        drawings: page.regions.filter((region) => region.type === "drawing").length,
        largeVisualRegions: page.regions.filter((region) => region.type !== "text" && (region.bounds.x2 - region.bounds.x1) * (region.bounds.y2 - region.bounds.y1) >= 0.05).map((region) => region.bounds)
      })).filter((page) => page.images || page.drawings)
    })),
    videos: sources.videos.filter((video) => !sourceId || video.id === sourceId).map((video) => ({ id: video.id, durationSeconds: video.durationSeconds, captionLanguage: video.language }))
  };
  const instructions: Record<StageName, string> = {
    sections: "Discover the document identity and a complete, ordered flat section map. Use meaningful outline entries when present but verify page bounds from exact text or pixels. Explicitly report uncovered front/back matter in save_sections.",
    figures: "Discover only figures with technical explanatory value. Use page regions as candidates, inspect full pages, preview/revise exact crops, then call save_figure for every accepted crop. It is correct to omit decorative images.",
    datasets: "Identify tables or matrices whose exact values benefit from deterministic lookup. Inspect the page pixels and text regions, transcribe values without inference, verify completed rows against the source, and call save_dataset for each verified dataset. Do not force prose into a dataset.",
    video: "Read the timestamped caption track in bounded ranges, create ordered topic-based segments, inspect an in-segment representative frame for every segment, and call save_video_segments with approved frame hashes.",
    finalize: "Call finalize_ingestion. If it reports validation issues, fix only those issues with the appropriate save/preview tools, then call finalize_ingestion again."
  };
  return `${instructions[stage]}${scope}\n\nDeterministic source summary:\n${JSON.stringify(summaries, null, 2)}`;
}

export function repairPrompt(stage: StageName, issues: string[]): string {
  return `The ${stage} stage was not accepted. Repair only the listed validation or completion issues, using source tools to re-check evidence. Do not use these issues as supplied answers. Call the required save/finalize tool again.\n\nIssues:\n${issues.map((issue) => `- ${issue}`).join("\n")}`;
}
