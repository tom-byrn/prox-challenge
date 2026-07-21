import MiniSearch from "minisearch";
import { evidenceRefId, uniqueEvidence, type EvidenceRef, type EvidenceSource } from "./evidence.js";
import { activeProductId, loadKnowledgePackage, productPackageDirectory } from "./knowledge-package.js";
import type { Process } from "./types.js";

type SearchDocument = {
  id: string;
  source: string;
  page: number;
  title: string;
  text: string;
  image: string;
};

type DatasetSearchDocument = {
  id: string;
  datasetId: string;
  title: string;
  text: string;
  recordId: string;
  sourceId: string;
  pages: number[];
};

export type FigureRecord = {
  id: string;
  title: string;
  source: string;
  pages: number[];
  file: string;
  caption: string;
  keywords: string[];
  answers?: string[];
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

const activePackage = loadKnowledgePackage(productPackageDirectory());

const searchDocuments: SearchDocument[] = activePackage
  ? activePackage.searchDocuments.map((document) => ({ ...document, source: document.documentId ?? document.source }))
  : [];
const figures: FigureRecord[] = activePackage
  ? activePackage.manifest.figures.map((figure) => ({
    id: figure.id,
    title: figure.title,
    source: figure.documentId,
    pages: [figure.page],
    file: figure.asset,
    caption: figure.caption,
    keywords: figure.keywords
  }))
  : [];
const videoKnowledge = activePackage ? {
  sourceId: activePackage.manifest.videos[0]?.id ?? "video",
  videoId: activePackage.manifest.videos[0]?.videoId ?? "video",
  title: activePackage.manifest.videos[0]?.title ?? "Video",
  url: activePackage.manifest.videos[0]?.url ?? "",
  captionType: activePackage.manifest.videos[0]?.captionType ?? "manual",
  authority: activePackage.manifest.videos[0]?.authority ?? "supplemental-demonstration",
  segments: activePackage.manifest.videoSegments.map((segment): VideoSegmentRecord => {
    const video = activePackage.manifest.videos.find((candidate) => candidate.id === segment.videoId);
    const transcript = video ? activePackage.readJson<{ captions: Array<{ startSeconds: number; durationSeconds: number; text: string }> }>(video.transcriptFile) : { captions: [] };
    return {
      ...segment,
      sourceId: segment.videoId,
      videoId: video?.videoId ?? segment.videoId,
      transcript: transcript.captions.filter((caption) => caption.startSeconds < segment.endSeconds && caption.startSeconds + caption.durationSeconds > segment.startSeconds).map((caption) => caption.text).join(" "),
      url: video ? `${video.url}${video.url.includes("?") ? "&" : "?"}t=${Math.floor(segment.startSeconds)}s` : "",
      authority: "supplemental-demonstration"
    };
  })
} : { sourceId: "video", videoId: "video", title: "Video", url: "", captionType: "manual", authority: "supplemental-demonstration" as const, segments: [] as VideoSegmentRecord[] };
const manualIndex = activePackage ? {
  product: activePackage.manifest.product.name,
  item: activePackage.manifest.product.id,
  sections: activePackage.manifest.sections.map((section) => ({
    title: section.title,
    source: section.documentId,
    pages: Array.from({ length: section.endPage - section.startPage + 1 }, (_, index) => section.startPage + index),
    summary: section.summary
  }))
} : { product: "", item: "", sections: [] };

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
  fields: ["title", "caption", "keywords"],
  storeFields: ["id", "title", "source", "pages", "file", "caption"],
  searchOptions: {
    boost: { title: 3, keywords: 2.5 },
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

const datasetSearchDocuments: DatasetSearchDocument[] = activePackage ? activePackage.manifest.datasets.flatMap((dataset) => {
  const stored = activePackage.readJson<{ records: Array<{ id: string; values: Record<string, string | number | boolean>; evidence: Array<{ documentId: string; page: number }> }> }>(dataset.recordsFile);
  return stored.records.map((record) => ({
    id: `${dataset.id}:${record.id}`,
    datasetId: dataset.id,
    title: dataset.title,
    text: Object.entries(record.values).map(([key, value]) => `${key}: ${value}`).join(" "),
    recordId: record.id,
    sourceId: record.evidence[0]?.documentId ?? dataset.evidence[0]?.documentId ?? "",
    pages: [...new Set(record.evidence.map((evidence) => evidence.page))]
  })).filter((record) => record.sourceId && record.pages.length);
}) : [];
const datasetSearch = new MiniSearch<DatasetSearchDocument>({
  fields: ["title", "text", "datasetId"],
  storeFields: ["datasetId", "title", "text", "recordId", "sourceId", "pages"],
  searchOptions: { boost: { title: 2.5, datasetId: 2 }, fuzzy: 0.2, prefix: true }
});
datasetSearch.addAll(datasetSearchDocuments);

const documentCatalog = activePackage.manifest.documents;

export function listDocuments() {
  return documentCatalog.map(({ id, title, sourceFile, pageCount, authority }) => ({ id, title, sourceFile, pageCount, authority }));
}

function documentRecord(sourceId: string) {
  const document = documentCatalog.find((candidate) => candidate.id === sourceId);
  if (!document) throw new Error(`Unknown document source: ${sourceId}`);
  return document;
}

export function getKnowledgeAssetPath(relativePath: string): string {
  return activePackage.assetPath(relativePath);
}

export function getKnowledgeAssetUrl(relativePath: string): string {
  return `/knowledge/products/${encodeURIComponent(activeProductId())}/${relativePath}`;
}

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

export function getKnowledgeProductInfo() {
  return {
    id: activePackage?.manifest.product.id ?? "omnipro-220",
    name: manualIndex.product,
    documents: listDocuments(),
    hasOmniProAdapter: activeProductId() === "omnipro-220"
  };
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
  const datasets = datasetSearch.search(query).slice(0, 5).map((result) => ({
    dataset: result.datasetId as string,
    recordId: result.recordId as string,
    title: result.title as string,
    valueSummary: result.text as string,
    ref: {
      kind: "structured-data" as const,
      dataset: result.datasetId as string,
      recordIds: [result.recordId as string],
      sourceId: result.sourceId as string,
      pages: result.pages as number[]
    },
    score: Number(result.score.toFixed(2))
  }));
  return {
    query,
    documents: manual.pages.map((page) => ({
      ...page,
      ref: { kind: "document" as const, sourceId: page.source, pages: [page.page] }
    })),
    figures: manual.figures.map((figure) => ({
      ...figure,
      ref: { kind: "figure" as const, figureId: figure.id as string }
    })),
    videos,
    datasets
  };
}

export function getPage(source: string, page: number) {
  const normalizedSource = source.toLowerCase().replace(/\s+/g, "-");
  const document = searchDocuments.find((candidate) => candidate.source === normalizedSource && candidate.page === page);
  if (!document) throw new Error(`No page ${page} in ${source}.`);
  return {
    ...document,
    imagePath: getKnowledgeAssetPath(document.image)
  };
}

export function getFigure(id: string): FigureRecord {
  const omniProFigureAliases: Record<string, string> = {
    "tig-cable-setup": "welder-cable-setup-stick-mig-flux-tig",
    "stick-cable-setup": "welder-cable-setup-stick-mig-flux-tig",
    "mig-flux-cable-setup": "welder-cable-setup-stick-mig-flux-tig",
    "cable-setup-quick-guide": "welder-cable-setup-stick-mig-flux-tig",
    "process-selection-chart": "welder-selection-chart",
    "mig-duty-cycle": "rated-duty-cycle",
    "tig-stick-duty-cycle": "rated-duty-cycle",
    "wire-weld-defects-a": "wire-weld-defect-profiles",
    "wire-weld-defects-b": "wire-weld-porosity-spatter",
    "stick-weld-defects-a": "stick-weld-diagnosis",
    "stick-weld-defects-b": "stick-weld-diagnosis",
    "feed-roller-guide": "spool-installation-diagram"
  };
  const resolvedId = activePackage && activeProductId() === "omnipro-220" ? (omniProFigureAliases[id] ?? id) : id;
  const figure = figures.find((candidate) => candidate.id === resolvedId);
  if (!figure) throw new Error(`Unknown figure id: ${id}`);
  return figure;
}

export function listFigures() {
  return figures.map(({ id, title, caption, source, pages, keywords }) => ({ id, title, caption, source, pages, keywords }));
}

export function getVideoSegment(id: string): VideoSegmentRecord {
  const exact = videoKnowledge.segments.find((candidate) => candidate.id === id);
  const legacyRange = id.match(/^(.+)@(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  const segment = exact ?? (legacyRange ? videoKnowledge.segments.find((candidate) =>
    candidate.id.startsWith(`${legacyRange[1]}@`)
    && Math.abs(candidate.startSeconds - Number(legacyRange[2])) <= 1
    && Math.abs(candidate.endSeconds - Number(legacyRange[3])) <= 1
  ) : undefined);
  if (!segment) throw new Error(`Unknown video segment: ${id}`);
  return segment;
}

function documentTitle(sourceId: string): string {
  return documentRecord(sourceId).title;
}

function documentUrl(sourceId: string, page: number): string {
  return `/files/${encodeURIComponent(documentRecord(sourceId).sourceFile)}#page=${page}`;
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
      previewUrl: documents[0] ? getKnowledgeAssetUrl(documents[0].image) : undefined
    };
  }
  if (ref.kind === "figure") {
    const figure = getFigure(ref.figureId);
    const sourceId = figure.source;
    return {
      id: evidenceRefId(ref),
      kind: "figure",
      ref,
      sourceId,
      pages: figure.pages,
      title: figure.title,
      caption: figure.caption,
      excerpt: figure.caption,
      previewUrl: getKnowledgeAssetUrl(figure.file),
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
      previewUrl: getKnowledgeAssetUrl(segment.frame),
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

type GeneratedRecord = {
  id: string;
  values: Record<string, string | number | boolean>;
  evidence: Array<{ documentId: string; page: number }>;
};

function generatedRecords(datasetId: string): GeneratedRecord[] {
  const dataset = activePackage.manifest.datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) return [];
  return activePackage.readJson<{ records: GeneratedRecord[] }>(dataset.recordsFile).records;
}

function pagesFor(records: GeneratedRecord[]): number[] {
  return [...new Set(records.flatMap((record) => record.evidence.map((evidence) => evidence.page)))].sort((a, b) => a - b);
}

export function lookupDutyCycle(processInput: string, inputVoltage: number, amps: number) {
  const normalized = normalizeProcess(processInput);
  if (!normalized) throw new Error(`Unknown welding process: ${processInput}`);
  const process = normalized === "FLUX_CORED" ? "MIG" : normalized;
  const spec = generatedRecords("welder-specifications").find((record) => {
    const values = record.values;
    return String(values.welding_process).toUpperCase() === process
      && String(values.input_voltage).startsWith(`${inputVoltage}VAC`);
  });
  const range = spec?.values.welding_current_range;
  const rangeEndpoints = typeof range === "string" ? range.match(/\d+/g)?.map(Number) : undefined;
  const candidates = generatedRecords("nameplate-duty-cycle-ratings")
    .filter((record) => String(record.values.input_voltage).startsWith(`${inputVoltage}V`))
    .filter((record) => {
      if (!rangeEndpoints || rangeEndpoints.length < 2) return true;
      const outputRange = String(record.values.output_range);
      const finalEndpoint = rangeEndpoints[rangeEndpoints.length - 1];
      return outputRange.includes(`${rangeEndpoints[0]}A`) && outputRange.includes(`${finalEndpoint}A`);
    })
    .map((record) => ({
      process,
      inputVoltage,
      amps: Number(record.values.i2_a),
      dutyPercent: Number(record.values.duty_cycle_pct),
      weldMinutes: Number(record.values.duty_cycle_pct) / 10,
      restMinutes: 10 - Number(record.values.duty_cycle_pct) / 10,
      pages: record.evidence.map((evidence) => evidence.page),
      recordId: record.id
    }))
    .filter((rating) => Number.isFinite(rating.amps));
  if (candidates.length === 0) throw new Error(`No published ${process} duty-cycle ratings for ${inputVoltage} V input.`);
  const exact = candidates.find((rating) => rating.amps === amps);
  if (exact) {
    return {
      exact: true,
      requested: { process: normalized, inputVoltage, amps },
      rating: exact,
      note: normalized === "FLUX_CORED" ? "The manual rates flux-cored output in the MIG/wire process section." : undefined,
      periodMinutes: 10,
      dataset: "nameplate-duty-cycle-ratings"
    };
  }
  const nearest = [...candidates]
    .sort((left, right) => Math.abs(left.amps - amps) - Math.abs(right.amps - amps))
    .slice(0, 2);
  return {
    exact: false,
    requested: { process: normalized, inputVoltage, amps },
    nearestPublishedRatings: nearest,
    policy: "Only published points are returned. Do not interpolate duty cycle between published amperages.",
    periodMinutes: 10,
    dataset: "nameplate-duty-cycle-ratings"
  };
}

export function lookupPolarity(processInput: string) {
  const normalized = normalizeProcess(processInput);
  if (!normalized) throw new Error(`Unknown welding process: ${processInput}`);
  const process = normalized === "FLUX_CORED" ? "Flux" : normalized.charAt(0) + normalized.slice(1).toLowerCase();
  const record = generatedRecords("welding-mode-terminal-polarity").find((candidate) => String(candidate.values.welding_mode).toLowerCase() === process.toLowerCase());
  if (!record) throw new Error(`No generated polarity setup found for ${processInput}.`);
  const values = record.values;
  const electrode = String(values.electrode_torch_wire_feed_terminal);
  return {
    id: record.id,
    process: normalized,
    polarity: /positive/i.test(electrode) ? "DCEP" : "DCEN",
    polarityMeaning: /positive/i.test(electrode) ? "Direct Current Electrode Positive" : "Direct Current Electrode Negative",
    groundClampSocket: String(values.ground_clamp_terminal).toLowerCase(),
    electrodeSocket: /positive/i.test(electrode) ? "positive" : "negative",
    electrodeLead: electrode,
    wireFeedConnected: String(values.wire_feed_power).toLowerCase() === "connected",
    additionalConnections: values.additional_connections,
    pages: { quickStart: record.evidence.map((evidence) => evidence.page) },
    dataset: "welding-mode-terminal-polarity"
  };
}

export function lookupTroubleshooting(symptom: string, processInput?: string) {
  const process = processInput ? normalizeProcess(processInput) : undefined;
  const result = searchSources(`${process ?? ""} troubleshooting ${symptom}`.trim(), 5);
  return { symptom, process, matches: result.documents, diagnosisMatches: result.figures, source: "generated knowledge package" };
}

export function getSpecs(processInput?: string) {
  const process = processInput ? normalizeProcess(processInput) : undefined;
  if (processInput && !process) throw new Error(`Unknown process: ${processInput}`);
  const records = generatedRecords("welder-specifications").filter((record) => !process || String(record.values.welding_process).toUpperCase() === (process === "FLUX_CORED" ? "MIG" : process));
  return { source: "generated knowledge package", dataset: "welder-specifications", process, records, pages: pagesFor(records) };
}

export function getSettingsGuide(processInput: string) {
  const process = normalizeProcess(processInput);
  if (!process) throw new Error(`Unknown process: ${processInput}`);
  const result = searchSources(`${process} settings setup wire material thickness`, 5);
  return { process, source: "generated knowledge package", documents: result.documents, datasets: result.datasets, figures: result.figures };
}

export function searchParts(query: string) {
  const result = searchSources(`parts assembly ${query}`, 5);
  return { query, source: "generated knowledge package", results: result.documents, figures: result.figures };
}
