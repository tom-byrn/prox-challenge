import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  KnowledgeManifestSchema,
  type Dataset,
  type DatasetRecord,
  type Figure,
  type KnowledgeManifest,
  type NormalizedBounds,
  type PreparedDocument,
  type PreparedVideo,
  type Section,
  type VideoSegment
} from "./schemas.js";
import { packagePath, sha256File } from "./workspace.js";

export type ValidationReport = {
  valid: boolean;
  issues: string[];
  warnings: string[];
  uncoveredPages: Record<string, number[]>;
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function area(bounds: NormalizedBounds): number {
  return (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1);
}

function intersection(left: NormalizedBounds, right: NormalizedBounds): number {
  return Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1))
    * Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
}

export function validateSections(sections: Section[], documents: PreparedDocument[]): ValidationReport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const uncoveredPages: Record<string, number[]> = {};
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  for (const duplicate of duplicates(sections.map((section) => section.id))) issues.push(`Duplicate section id: ${duplicate}`);

  for (const section of sections) {
    const document = documentsById.get(section.documentId);
    if (!document) {
      issues.push(`Section ${section.id} references unknown document ${section.documentId}.`);
      continue;
    }
    if (section.startPage > section.endPage) issues.push(`Section ${section.id} has a reversed page range.`);
    if (section.endPage > document.pageCount) issues.push(`Section ${section.id} ends after page ${document.pageCount}.`);
    for (const heading of section.headingEvidence) {
      if (heading.page < section.startPage || heading.page > section.endPage) {
        issues.push(`Heading evidence for ${section.id} is outside its page span.`);
        continue;
      }
      if (!heading.visualOnly) {
        const page = document.pages.find((candidate) => candidate.page === heading.page);
        if (!page) continue;
        const textPath = resolve(document.sourcePath, page.textFile);
        const pageText = existsSync(textPath) ? readFileSync(textPath, "utf8") : "";
        if (!normalizeText(pageText).includes(normalizeText(heading.text))) {
          issues.push(`Heading evidence for ${section.id} does not occur on ${document.id} page ${heading.page}.`);
        }
      }
    }
  }

  for (const document of documents) {
    const covered = new Set<number>();
    const ordered = sections.filter((section) => section.documentId === document.id)
      .sort((left, right) => left.startPage - right.startPage || left.endPage - right.endPage || left.id.localeCompare(right.id));
    const submitted = sections.filter((section) => section.documentId === document.id);
    if (submitted.some((section, index) => section.id !== ordered[index]?.id)) issues.push(`Sections for ${document.id} are not in stable page order.`);
    for (const [index, section] of ordered.entries()) {
      for (let page = section.startPage; page <= section.endPage; page += 1) covered.add(page);
      const previous = ordered[index - 1];
      if (previous && section.startPage <= previous.endPage) warnings.push(`Sections ${previous.id} and ${section.id} overlap.`);
    }
    uncoveredPages[document.id] = Array.from({ length: document.pageCount }, (_, index) => index + 1).filter((page) => !covered.has(page));
  }
  return { valid: issues.length === 0, issues, warnings, uncoveredPages };
}

export function validateFigures(figures: Figure[], documents: PreparedDocument[]): string[] {
  const issues: string[] = [];
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  for (const duplicate of duplicates(figures.map((figure) => figure.id))) issues.push(`Duplicate figure id: ${duplicate}`);
  for (const figure of figures) {
    const document = documentsById.get(figure.documentId);
    if (!document) {
      issues.push(`Figure ${figure.id} references unknown document ${figure.documentId}.`);
      continue;
    }
    if (figure.page > document.pageCount) issues.push(`Figure ${figure.id} references page ${figure.page} after ${document.pageCount}.`);
    const width = figure.bounds.x2 - figure.bounds.x1;
    const height = figure.bounds.y2 - figure.bounds.y1;
    if (width < 0.05 || height < 0.05) issues.push(`Figure ${figure.id} is too small to be useful.`);
    if (area(figure.bounds) > 0.94 && figure.type !== "full-page") issues.push(`Figure ${figure.id} is effectively a full page but is typed ${figure.type}.`);
  }
  for (const [index, figure] of figures.entries()) {
    for (const other of figures.slice(index + 1)) {
      if (figure.documentId !== other.documentId || figure.page !== other.page) continue;
      const overlap = intersection(figure.bounds, other.bounds) / Math.min(area(figure.bounds), area(other.bounds));
      if (overlap > 0.92) issues.push(`Figures ${figure.id} and ${other.id} are near-duplicate crops.`);
    }
  }
  return issues;
}

export function validateDataset(dataset: Dataset, records: DatasetRecord[], documents: PreparedDocument[]): string[] {
  const issues: string[] = [];
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const fields = Object.entries(dataset.schema);
  if (fields.length === 0 || fields.length > 50) issues.push(`Dataset ${dataset.id} must declare 1-50 fields.`);
  for (const duplicate of duplicates(records.map((record) => record.id))) issues.push(`Duplicate record id ${duplicate} in ${dataset.id}.`);
  for (const record of records) {
    const recordKeys = Object.keys(record.values);
    for (const [name, expectedType] of fields) {
      const value = record.values[name];
      if (value === undefined) issues.push(`Dataset ${dataset.id} record ${record.id} is missing ${name}.`);
      else if (typeof value !== expectedType) issues.push(`Dataset ${dataset.id} record ${record.id}.${name} must be ${expectedType}.`);
      if (expectedType === "number" && typeof value === "number" && !Number.isFinite(value)) issues.push(`Dataset ${dataset.id} record ${record.id}.${name} is not finite.`);
    }
    for (const unknown of recordKeys.filter((key) => !(key in dataset.schema))) issues.push(`Dataset ${dataset.id} record ${record.id} has undeclared field ${unknown}.`);
    for (const evidence of record.evidence) {
      const document = documentsById.get(evidence.documentId);
      if (!document || evidence.page > document.pageCount) issues.push(`Dataset ${dataset.id} record ${record.id} has invalid evidence ${evidence.documentId}:${evidence.page}.`);
    }
  }
  return issues;
}

export function validateVideoSegments(segments: VideoSegment[], videos: PreparedVideo[]): string[] {
  const issues: string[] = [];
  const videosById = new Map(videos.map((video) => [video.id, video]));
  for (const duplicate of duplicates(segments.map((segment) => segment.id))) issues.push(`Duplicate video segment id: ${duplicate}`);
  for (const segment of segments) {
    const video = videosById.get(segment.videoId);
    if (!video) {
      issues.push(`Segment ${segment.id} references unknown video ${segment.videoId}.`);
      continue;
    }
    if (segment.endSeconds <= segment.startSeconds || segment.endSeconds > video.durationSeconds + 0.01) issues.push(`Segment ${segment.id} has invalid boundaries.`);
    if (segment.frameSeconds < segment.startSeconds || segment.frameSeconds > segment.endSeconds) issues.push(`Segment ${segment.id} frame is outside its boundaries.`);
    const overlap = video.captions.some((caption) => caption.startSeconds < segment.endSeconds && caption.startSeconds + caption.durationSeconds > segment.startSeconds);
    if (!overlap) issues.push(`Segment ${segment.id} contains no transcript captions.`);
    const expectedId = `video:${video.id}@${segment.startSeconds}-${segment.endSeconds}`;
    if (segment.id !== expectedId) issues.push(`Segment ${segment.id} must use derived id ${expectedId}.`);
  }
  if (segments.some((segment, index) => {
    const previous = segments[index - 1];
    return previous && previous.videoId === segment.videoId && segment.startSeconds < previous.startSeconds;
  })) issues.push("Video segments are not ordered.");
  return issues;
}

export async function validatePackage(directory: string, expectedSourcePaths?: Record<string, string>): Promise<KnowledgeManifest> {
  const manifestPath = packagePath(directory, "manifest.json");
  const manifest = KnowledgeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const referenced = [
    "search-documents.json",
    ...manifest.figures.map((figure) => figure.asset),
    ...manifest.datasets.map((dataset) => dataset.recordsFile),
    ...manifest.videos.map((video) => video.transcriptFile),
    ...manifest.videoSegments.map((segment) => segment.frame),
    ...manifest.documents.flatMap((document) => Array.from({ length: document.pageCount }, (_, index) => `pages/${document.id}-${String(index + 1).padStart(2, "0")}.png`))
  ];
  for (const relativePath of referenced) {
    const path = packagePath(directory, relativePath);
    if (!existsSync(path)) throw new Error(`Manifest references missing asset: ${relativePath}`);
  }
  for (const figure of manifest.figures) {
    const metadata = await sharp(packagePath(directory, figure.asset)).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Figure is not a readable image: ${figure.asset}`);
    const pagePath = packagePath(directory, `pages/${figure.documentId}-${String(figure.page).padStart(2, "0")}.png`);
    const pageMetadata = await sharp(pagePath).metadata();
    const expectedWidth = Math.ceil((pageMetadata.width ?? 0) * figure.bounds.x2) - Math.floor((pageMetadata.width ?? 0) * figure.bounds.x1);
    const expectedHeight = Math.ceil((pageMetadata.height ?? 0) * figure.bounds.y2) - Math.floor((pageMetadata.height ?? 0) * figure.bounds.y1);
    if (Math.abs(metadata.width - expectedWidth) > 1 || Math.abs(metadata.height - expectedHeight) > 1) throw new Error(`Figure dimensions do not match approved bounds: ${figure.asset}`);
  }
  for (const segment of manifest.videoSegments) {
    const statistics = await sharp(packagePath(directory, segment.frame)).stats();
    const entropy = statistics.entropy ?? 0;
    if (entropy < 0.05) throw new Error(`Video frame is predominantly blank: ${segment.frame}`);
  }
  if (expectedSourcePaths) {
    for (const document of manifest.documents) {
      const source = expectedSourcePaths[document.id];
      if (!source || sha256File(source) !== document.sha256) throw new Error(`Source hash changed for ${document.id}.`);
    }
  }
  return manifest;
}
