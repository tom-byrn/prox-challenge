import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { KnowledgeManifestSchema, type IngestionRun, type KnowledgeManifest } from "./schemas.js";
import type { IngestionCheckpoint, IngestionWorkspace, PreparedSources } from "./types.js";
import { IngestionSourceReader } from "./source-reader.js";
import { validateDataset, validateFigures, validatePackage, validateSections, validateVideoSegments } from "./validate.js";
import { packagePath, writeJsonAtomic } from "./workspace.js";

export type MaterializedSearchDocument = {
  id: string;
  documentId: string;
  source: string;
  page: number;
  title: string;
  text: string;
  image: string;
};

function framePreviewPath(workspace: IngestionWorkspace, videoId: string, seconds: number): string {
  return join(workspace.previewsDir, "video", videoId, `${String(Number(seconds.toFixed(3))).replace(".", "-")}.jpg`);
}

export async function materializePackage({
  sources,
  workspace,
  checkpoint,
  run
}: {
  sources: PreparedSources;
  workspace: IngestionWorkspace;
  checkpoint: IngestionCheckpoint;
  run: IngestionRun;
}): Promise<KnowledgeManifest> {
  if (!checkpoint.ready) throw new Error("Cannot materialize an ingestion run that has not passed finalize_ingestion.");
  const sectionReport = validateSections(checkpoint.sections, sources.documents);
  const issues = [
    ...sectionReport.issues,
    ...validateFigures(checkpoint.figures, sources.documents),
    ...checkpoint.datasets.flatMap(({ dataset, records }) => validateDataset(dataset, records, sources.documents)),
    ...validateVideoSegments(checkpoint.videoSegments, sources.videos)
  ];
  if (issues.length) throw new Error(`Cannot materialize invalid staging data: ${issues.join(" ")}`);

  rmSync(workspace.finalizedDir, { recursive: true, force: true });
  for (const directory of ["pages", "figures", "tables", "video"]) mkdirSync(join(workspace.finalizedDir, directory), { recursive: true });
  const reader = new IngestionSourceReader(workspace.preparedDir, sources.documents, sources.videos);
  const searchDocuments: MaterializedSearchDocument[] = [];

  for (const document of sources.documents) {
    for (const page of document.pages) {
      const stem = `${document.id}-${String(page.page).padStart(2, "0")}`;
      const image = `pages/${stem}.png`;
      const textFile = `pages/${stem}.txt`;
      cpSync(reader.preparedPath(document.id, page.imageFile), packagePath(workspace.finalizedDir, image));
      cpSync(reader.preparedPath(document.id, page.textFile), packagePath(workspace.finalizedDir, textFile));
      const section = checkpoint.sections
        .filter((candidate) => candidate.documentId === document.id && page.page >= candidate.startPage && page.page <= candidate.endPage)
        .sort((left, right) => left.endPage - left.startPage - (right.endPage - right.startPage))[0];
      searchDocuments.push({
        id: stem,
        documentId: document.id,
        source: document.id,
        page: page.page,
        title: section?.title ?? checkpoint.documentTitles[document.id] ?? document.id,
        text: readFileSync(reader.preparedPath(document.id, page.textFile), "utf8"),
        image
      });
    }
  }

  for (const figure of checkpoint.figures) {
    const preview = join(workspace.previewsDir, "figures", `${figure.previewHash}.png`);
    if (!existsSync(preview)) throw new Error(`Approved preview is missing for ${figure.id}.`);
    const target = packagePath(workspace.finalizedDir, figure.asset);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(preview, target);
  }

  for (const { dataset, records } of checkpoint.datasets) {
    writeJsonAtomic(packagePath(workspace.finalizedDir, dataset.recordsFile), { schemaVersion: 1, datasetId: dataset.id, records });
  }

  for (const video of sources.videos) {
    const transcriptFile = `video/${video.id}/transcript.json`;
    writeJsonAtomic(packagePath(workspace.finalizedDir, transcriptFile), {
      sourceId: video.id,
      videoId: video.videoId,
      title: video.title,
      url: video.url,
      language: video.language,
      isGenerated: video.isGenerated,
      durationSeconds: video.durationSeconds,
      captions: video.captions
    });
    const segments = checkpoint.videoSegments.filter((segment) => segment.videoId === video.id);
    for (const segment of segments) {
      const preview = framePreviewPath(workspace, video.id, segment.frameSeconds);
      if (!existsSync(preview)) throw new Error(`Approved frame is missing for ${segment.id}.`);
      const destination = packagePath(workspace.finalizedDir, segment.frame);
      mkdirSync(dirname(destination), { recursive: true });
      await sharp(preview).jpeg({ quality: 88 }).toFile(destination);
    }
    writeJsonAtomic(packagePath(workspace.finalizedDir, `video/${video.id}/segments.json`), segments.map((segment) => ({
      ...segment,
      sourceId: video.id,
      transcript: video.captions.filter((caption) => caption.startSeconds < segment.endSeconds && caption.startSeconds + caption.durationSeconds > segment.startSeconds).map((caption) => caption.text).join(" "),
      url: `${video.url}${video.url.includes("?") ? "&" : "?"}t=${Math.floor(segment.startSeconds)}s`,
      authority: video.authority
    })));
  }

  const manifest = KnowledgeManifestSchema.parse({
    schemaVersion: 1,
    product: { id: sources.config.productId, name: sources.config.productName },
    documents: sources.documents.map((document) => ({
      id: document.id,
      title: checkpoint.documentTitles[document.id],
      sourceFile: document.sourceFile,
      sha256: document.sha256,
      pageCount: document.pageCount,
      authority: document.authority,
      outlineAvailable: document.outlineAvailable
    })),
    sections: checkpoint.sections,
    figures: checkpoint.figures,
    datasets: checkpoint.datasets.map(({ dataset }) => dataset),
    videos: sources.videos.map((video) => ({
      id: video.id,
      videoId: video.videoId,
      title: video.title,
      url: video.url,
      captionType: video.isGenerated ? "auto-generated" : "manual",
      transcriptFile: `video/${video.id}/transcript.json`,
      sha256: video.sha256,
      authority: video.authority
    })),
    videoSegments: checkpoint.videoSegments,
    ingestionRuns: [run]
  });
  writeJsonAtomic(join(workspace.finalizedDir, "manifest.json"), manifest);
  writeJsonAtomic(join(workspace.finalizedDir, "search-documents.json"), searchDocuments);
  writeJsonAtomic(join(workspace.finalizedDir, "sections.json"), checkpoint.sections);
  await validatePackage(workspace.finalizedDir);
  return manifest;
}
