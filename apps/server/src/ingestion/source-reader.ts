import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  PreparedDocumentSchema,
  PreparedVideoSchema,
  type PreparedDocument,
  type PreparedVideo
} from "./schemas.js";
import { assertInside } from "./workspace.js";

export class IngestionSourceReader {
  readonly documents: Map<string, PreparedDocument>;
  readonly videos: Map<string, PreparedVideo>;

  constructor(readonly preparedDir: string, documents: PreparedDocument[], videos: PreparedVideo[]) {
    this.documents = new Map(documents.map((document) => [document.id, PreparedDocumentSchema.parse(document)]));
    this.videos = new Map(videos.map((video) => [video.id, PreparedVideoSchema.parse(video)]));
    if (this.documents.size !== documents.length || this.videos.size !== videos.length) throw new Error("Prepared source ids must be unique.");
  }

  static load(preparedDir: string): IngestionSourceReader {
    const indexPath = join(preparedDir, "sources.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { documents: string[]; videos: string[] };
    const documents = index.documents.map((path) => PreparedDocumentSchema.parse(JSON.parse(readFileSync(assertInside(preparedDir, join(preparedDir, path)), "utf8"))));
    const videos = index.videos.map((path) => PreparedVideoSchema.parse(JSON.parse(readFileSync(assertInside(preparedDir, join(preparedDir, path)), "utf8"))));
    return new IngestionSourceReader(preparedDir, documents, videos);
  }

  document(id: string): PreparedDocument {
    const document = this.documents.get(id);
    if (!document) throw new Error(`Unknown registered document: ${id}`);
    return document;
  }

  video(id: string): PreparedVideo {
    const video = this.videos.get(id);
    if (!video) throw new Error(`Unknown registered video: ${id}`);
    return video;
  }

  page(documentId: string, pageNumber: number) {
    const document = this.document(documentId);
    const page = document.pages.find((candidate) => candidate.page === pageNumber);
    if (!page) throw new Error(`Page ${pageNumber} is outside ${documentId} (1-${document.pageCount}).`);
    return page;
  }

  preparedPath(documentId: string, relativePath: string): string {
    const metadataPath = join(this.preparedDir, documentId, "document.json");
    const root = dirname(metadataPath);
    const path = assertInside(root, join(root, relativePath));
    if (!existsSync(path)) throw new Error(`Prepared source asset is missing: ${documentId}/${relativePath}`);
    return path;
  }

  readPageText(documentId: string, startPage: number, endPage: number, maxPages = 8) {
    const document = this.document(documentId);
    if (endPage < startPage || endPage - startPage + 1 > maxPages) throw new Error(`read_page_text accepts at most ${maxPages} ordered pages.`);
    return Array.from({ length: endPage - startPage + 1 }, (_, index) => {
      const page = this.page(documentId, startPage + index);
      return {
        page: page.page,
        textAvailable: page.textAvailable,
        text: readFileSync(this.preparedPath(documentId, page.textFile), "utf8"),
        regions: page.regions.filter((region) => region.type === "text")
      };
    });
  }

  transcript(videoId: string, startSeconds: number, endSeconds: number, maxSeconds = 600) {
    const video = this.video(videoId);
    if (startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > maxSeconds || endSeconds > video.durationSeconds + 0.01) {
      throw new Error(`Transcript range must be ordered, within the video, and no longer than ${maxSeconds} seconds.`);
    }
    return video.captions.filter((caption) => (
      caption.startSeconds < endSeconds
      && caption.startSeconds + caption.durationSeconds > startSeconds
    ));
  }
}
