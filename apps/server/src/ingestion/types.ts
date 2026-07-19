import type {
  Dataset,
  DatasetRecord,
  Figure,
  IngestionConfig,
  IngestionRun,
  KnowledgeManifest,
  PreparedDocument,
  PreparedVideo,
  Section,
  VideoSegment
} from "./schemas.js";

export type StageName = "sections" | "figures" | "datasets" | "video" | "finalize";

export type IngestionCheckpoint = {
  documentTitles: Record<string, string>;
  sections: Section[];
  figures: Figure[];
  datasets: Array<{ dataset: Dataset; records: DatasetRecord[] }>;
  videoSegments: VideoSegment[];
  ready: boolean;
};

export type PreparedSources = {
  config: IngestionConfig;
  documents: PreparedDocument[];
  videos: PreparedVideo[];
};

export type IngestionTelemetryEvent = {
  stage: StageName;
  tool: string;
  sourceIds: string[];
  durationMs: number;
  success: boolean;
  error?: string;
};

export type IngestionWorkspace = {
  runId: string;
  root: string;
  preparedDir: string;
  checkpointsDir: string;
  previewsDir: string;
  finalizedDir: string;
  targetDir: string;
};

export type IngestionResult = {
  manifest: KnowledgeManifest;
  run: IngestionRun;
  packageDir: string;
};
