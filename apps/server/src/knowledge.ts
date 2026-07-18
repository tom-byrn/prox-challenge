import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import { evidenceRefId, uniqueEvidence, type EvidenceRef, type EvidenceSource } from "./evidence.js";
import type { Process } from "./types.js";

type SearchDocument = {
  id: string;
  source: string;
  page: number;
  title: string;
  text: string;
  image: string;
};

export type FigureRecord = {
  id: string;
  title: string;
  source: string;
  pages: number[];
  file: string;
  caption: string;
  keywords: string[];
  answers: string[];
};

export type VideoSegmentRecord = {
  id: string;
  sourceId: string;
  videoId: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  frameSeconds: number;
  frame: string;
  summary: string;
  keywords: string[];
  transcript: string;
  url: string;
  authority: "supplemental-demonstration";
};

type DutyRating = {
  process: "MIG" | "TIG" | "STICK";
  inputVoltage: number;
  amps: number;
  dutyPercent: number;
  weldMinutes: number;
  restMinutes: number;
  pages: number[];
};

type TroubleshootingEntry = {
  id: string;
  processes: Process[];
  symptom: string;
  questions?: string[];
  checks: Array<{
    appliesTo?: Process[];
    cause: string;
    action: string;
  }>;
  pages: number[];
  figureId?: string;
};

const KNOWLEDGE_DIR = fileURLToPath(new URL("../../../knowledge/", import.meta.url));

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, new URL(`file://${KNOWLEDGE_DIR}/`)), "utf8")) as T;
}

const searchDocuments = loadJson<SearchDocument[]>("search-documents.json");
const figures = loadJson<FigureRecord[]>("figures.json");
const videoKnowledge = loadJson<{
  sourceId: string;
  videoId: string;
  title: string;
  url: string;
  captionType: string;
  authority: "supplemental-demonstration";
  segments: VideoSegmentRecord[];
}>("video/segments.json");
const manualIndex = loadJson<{ product: string; item: string; sections: Array<{ title: string; source: string; pages: number[]; summary: string }> }>("index.json");
const dutyCycles = loadJson<{ periodMinutes: number; policy: string; ratings: DutyRating[] }>("tables/duty_cycles.json");
const specs = loadJson<Record<string, unknown>>("tables/specs.json");
const polarity = loadJson<{ setups: Array<Record<string, unknown> & { id: string; process: Process; aliases: string[] }> }>("tables/polarity.json");
const troubleshooting = loadJson<{ entries: TroubleshootingEntry[] }>("tables/troubleshooting.json");
const weldDiagnosis = loadJson<{ entries: Array<Record<string, unknown> & { id: string; defect: string; processes: Process[] }> }>("tables/weld_diagnosis.json");
const settingsGuide = loadJson<{ modes: Array<Record<string, unknown> & { process: Process }> }>("tables/settings_guide.json");
const parts = loadJson<{ parts: Array<{ number: number; description: string; quantity: number }>; listPage: number; diagramPage: number; orderingNote: string }>("tables/parts.json");

const pageSearch = new MiniSearch<SearchDocument>({
  fields: ["title", "text", "source"],
  storeFields: ["id", "source", "page", "title", "text", "image"],
  searchOptions: {
    boost: { title: 2.5 },
    fuzzy: 0.2,
    prefix: true
  }
});
pageSearch.addAll(searchDocuments);

const figureSearch = new MiniSearch<FigureRecord>({
  fields: ["title", "caption", "keywords", "answers"],
  storeFields: ["id", "title", "source", "pages", "file", "caption"],
  searchOptions: {
    boost: { title: 3, keywords: 2.5, answers: 2 },
    fuzzy: 0.2,
    prefix: true
  }
});
figureSearch.addAll(figures);

const videoSearch = new MiniSearch<VideoSegmentRecord>({
  fields: ["title", "summary", "keywords", "transcript"],
  storeFields: ["id", "sourceId", "videoId", "title", "startSeconds", "endSeconds", "frame", "summary", "transcript", "url", "authority"],
  searchOptions: {
    boost: { title: 3, keywords: 2.5, summary: 2 },
    fuzzy: 0.2,
    prefix: true
  }
});
videoSearch.addAll(videoKnowledge.segments);

function normalizeProcess(value: string): Process | undefined {
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["MIG", "GMAW", "SOLID_WIRE"].includes(normalized)) return "MIG";
  if (["FLUX", "FLUX_CORED", "FCAW", "FCAW_S", "GASLESS"].includes(normalized)) return "FLUX_CORED";
  if (["TIG", "GTAW", "LIFT_TIG"].includes(normalized)) return "TIG";
  if (["STICK", "SMAW"].includes(normalized)) return "STICK";
  return undefined;
}

function makeSnippet(text: string, terms: string[], maxLength = 460): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  const lower = singleLine.toLowerCase();
  let position = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  position = Math.max(0, position - 130);
  let snippet = singleLine.slice(position, position + maxLength);
  if (position > 0) snippet = `…${snippet}`;
  if (position + maxLength < singleLine.length) snippet = `${snippet}…`;
  return snippet;
}

function tokenOverlapScore(query: string, text: string): number {
  const tokens = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  if (haystack.includes(query.toLowerCase())) score += 4;
  return score;
}

export function getManualMap(): string {
  return manualIndex.sections
    .map((section) => `${section.title} — ${section.source} pp. ${section.pages.join(", ")}: ${section.summary}`)
    .join("\n");
}

export function searchManual(query: string, limit = 6) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pages = pageSearch.search(query).slice(0, limit).map((result) => ({
    source: result.source,
    page: result.page,
    title: result.title,
    snippet: makeSnippet(result.text as string, terms),
    score: Number(result.score.toFixed(2))
  }));
  const matchedFigures = figureSearch.search(query).slice(0, 4).map((result) => ({
    id: result.id,
    title: result.title,
    source: result.source,
    pages: result.pages,
    caption: result.caption,
    score: Number(result.score.toFixed(2))
  }));
  return { query, pages, figures: matchedFigures };
}

export function searchSources(query: string, limit = 6) {
  const manual = searchManual(query, limit);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const videos = videoSearch.search(query).slice(0, 3).map((result) => ({
    ref: { kind: "video" as const, segmentId: result.id as string },
    id: result.id,
    title: result.title,
    startSeconds: result.startSeconds,
    endSeconds: result.endSeconds,
    summary: result.summary,
    transcriptSnippet: makeSnippet(result.transcript as string, terms, 360),
    authority: result.authority,
    score: Number(result.score.toFixed(2))
  }));
  return {
    query,
    documents: manual.pages.map((page) => ({
      ...page,
      ref: { kind: "document" as const, sourceId: page.source as "owner-manual" | "quick-start" | "selection-chart", pages: [page.page] }
    })),
    figures: manual.figures.map((figure) => ({
      ...figure,
      ref: { kind: "figure" as const, figureId: figure.id as string }
    })),
    videos
  };
}

export function getPage(source: string, page: number) {
  const normalizedSource = source.toLowerCase().replace(/\s+/g, "-");
  const document = searchDocuments.find((candidate) => candidate.source === normalizedSource && candidate.page === page);
  if (!document) throw new Error(`No page ${page} in ${source}.`);
  return {
    ...document,
    imagePath: fileURLToPath(new URL(document.image, new URL(`file://${KNOWLEDGE_DIR}/`)))
  };
}

export function getFigure(id: string): FigureRecord {
  const figure = figures.find((candidate) => candidate.id === id);
  if (!figure) throw new Error(`Unknown figure id: ${id}`);
  return figure;
}

export function listFigures() {
  return figures.map(({ id, title, caption, source, pages, keywords }) => ({ id, title, caption, source, pages, keywords }));
}

export function getVideoSegment(id: string): VideoSegmentRecord {
  const segment = videoKnowledge.segments.find((candidate) => candidate.id === id);
  if (!segment) throw new Error(`Unknown video segment: ${id}`);
  return segment;
}

function documentTitle(sourceId: "owner-manual" | "quick-start" | "selection-chart"): string {
  if (sourceId === "owner-manual") return "Owner's Manual";
  if (sourceId === "quick-start") return "Quick Start Guide";
  return "Process Selection Chart";
}

function documentUrl(sourceId: "owner-manual" | "quick-start" | "selection-chart", page: number): string {
  const filename = sourceId === "owner-manual" ? "owner-manual.pdf"
    : sourceId === "quick-start" ? "quick-start-guide.pdf"
      : "selection-chart.pdf";
  return `/files/${filename}#page=${page}`;
}

export function resolveEvidenceRef(ref: EvidenceRef): EvidenceSource {
  if (ref.kind === "document") {
    const documents = ref.pages
      .map((page) => searchDocuments.find((candidate) => candidate.source === ref.sourceId && candidate.page === page))
      .filter((document): document is SearchDocument => document !== undefined);
    return {
      id: evidenceRefId(ref),
      kind: "document",
      ref,
      sourceId: ref.sourceId,
      pages: ref.pages,
      title: documentTitle(ref.sourceId),
      excerpt: documents.map((document) => makeSnippet(document.text, [], 300)).join(" "),
      url: documentUrl(ref.sourceId, ref.pages[0] ?? 1),
      previewUrl: documents[0] ? `/knowledge/${documents[0].image}` : undefined
    };
  }
  if (ref.kind === "figure") {
    const figure = getFigure(ref.figureId);
    const sourceId = figure.source as "owner-manual" | "quick-start" | "selection-chart";
    return {
      id: evidenceRefId(ref),
      kind: "figure",
      ref,
      sourceId,
      pages: figure.pages,
      title: figure.title,
      caption: figure.caption,
      excerpt: figure.caption,
      previewUrl: `/knowledge/${figure.file}`,
      url: documentUrl(sourceId, figure.pages[0] ?? 1),
      derivedFrom: [{ kind: "document", sourceId, pages: figure.pages }]
    };
  }
  if (ref.kind === "video") {
    const segment = getVideoSegment(ref.segmentId);
    return {
      id: evidenceRefId(ref),
      kind: "video",
      ref,
      sourceId: segment.sourceId,
      videoId: segment.videoId,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      captionType: videoKnowledge.captionType,
      title: segment.title,
      excerpt: segment.transcript,
      previewUrl: `/knowledge/${segment.frame}`,
      url: segment.url
    };
  }
  const title = ref.dataset.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  return {
    id: evidenceRefId(ref),
    kind: "structured-data",
    ref,
    dataset: ref.dataset,
    recordIds: ref.recordIds,
    sourceId: ref.sourceId,
    pages: ref.pages,
    title,
    url: documentUrl(ref.sourceId, ref.pages[0] ?? 1),
    derivedFrom: [{ kind: "document", sourceId: ref.sourceId, pages: ref.pages }]
  };
}

export function resolveEvidenceRefs(refs: EvidenceRef[]): EvidenceSource[] {
  return uniqueEvidence(refs.map(resolveEvidenceRef));
}

export function lookupDutyCycle(processInput: string, inputVoltage: number, amps: number) {
  const normalized = normalizeProcess(processInput);
  if (!normalized) throw new Error(`Unknown welding process: ${processInput}`);
  const process = normalized === "FLUX_CORED" ? "MIG" : normalized;
  const candidates = dutyCycles.ratings.filter((rating) => rating.process === process && rating.inputVoltage === inputVoltage);
  if (candidates.length === 0) throw new Error(`No published ${process} duty-cycle ratings for ${inputVoltage} V input.`);
  const exact = candidates.find((rating) => rating.amps === amps);
  if (exact) {
    return {
      exact: true,
      requested: { process: normalized, inputVoltage, amps },
      rating: exact,
      note: normalized === "FLUX_CORED" ? "The manual rates flux-cored output in the MIG/wire process section." : undefined,
      periodMinutes: dutyCycles.periodMinutes
    };
  }
  const nearest = [...candidates]
    .sort((left, right) => Math.abs(left.amps - amps) - Math.abs(right.amps - amps))
    .slice(0, 2);
  return {
    exact: false,
    requested: { process: normalized, inputVoltage, amps },
    nearestPublishedRatings: nearest,
    policy: dutyCycles.policy,
    periodMinutes: dutyCycles.periodMinutes
  };
}

export function lookupPolarity(processInput: string) {
  const normalized = normalizeProcess(processInput);
  const query = processInput.toLowerCase();
  const setup = polarity.setups.find((candidate) => candidate.process === normalized)
    ?? polarity.setups.find((candidate) => candidate.aliases.some((alias) => query.includes(alias.toLowerCase())));
  if (!setup) throw new Error(`No polarity setup found for ${processInput}. Specify MIG, self-shielded flux-cored, TIG, or stick.`);
  return setup;
}

export function lookupTroubleshooting(symptom: string, processInput?: string) {
  const process = processInput ? normalizeProcess(processInput) : undefined;
  const matches = troubleshooting.entries
    .filter((entry) => !process || entry.processes.includes(process))
    .map((entry) => ({ entry, score: tokenOverlapScore(symptom, `${entry.symptom} ${entry.checks.map((check) => `${check.cause} ${check.action}`).join(" ")}`) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ entry, score }) => ({
      ...entry,
      score,
      checks: entry.checks.filter((check) => !process || !check.appliesTo || check.appliesTo.includes(process))
    }));

  const diagnosisMatches = weldDiagnosis.entries
    .filter((entry) => !process || entry.processes.includes(process))
    .map((entry) => ({ ...entry, score: tokenOverlapScore(symptom, entry.defect) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  return { symptom, process, matches, diagnosisMatches };
}

export function getSpecs(processInput?: string) {
  if (!processInput) return specs;
  const process = normalizeProcess(processInput);
  if (!process) throw new Error(`Unknown process: ${processInput}`);
  const specProcess = process === "FLUX_CORED" ? "MIG" : process;
  const processMap = (specs.processes ?? {}) as Record<string, unknown>;
  return { source: specs.source, pages: specs.pages, process, specs: processMap[specProcess] };
}

export function getSettingsGuide(processInput: string) {
  const process = normalizeProcess(processInput);
  if (!process) throw new Error(`Unknown process: ${processInput}`);
  const mode = settingsGuide.modes.find((candidate) => candidate.process === process);
  if (!mode) throw new Error(`No settings guidance found for ${processInput}.`);
  return { accuracyNote: (settingsGuide as Record<string, unknown>).accuracyNote, mode, source: (settingsGuide as Record<string, unknown>).source, pages: (settingsGuide as Record<string, unknown>).pages };
}

export function searchParts(query: string) {
  const directNumber = Number.parseInt(query, 10);
  const results = parts.parts
    .map((part) => ({ part, score: Number.isFinite(directNumber) && part.number === directNumber ? 100 : tokenOverlapScore(query, part.description) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map(({ part }) => part);
  return { query, results, listPage: parts.listPage, diagramPage: parts.diagramPage, orderingNote: parts.orderingNote, figureId: "assembly-diagram" };
}
