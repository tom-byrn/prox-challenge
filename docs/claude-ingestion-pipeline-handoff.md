# Claude-assisted knowledge ingestion: implementation handoff

## Why this work exists

The current application has a generic runtime visual grammar, but its offline knowledge ingestion is not generic. The PDF build script contains Codex-authored, product-specific `SECTIONS` and `FIGURE_DEFS` constants. The video build script similarly contains a product-specific video id and `SEGMENTS` list. Those scripts automate rendering, cropping, and JSON writing, but they do not discover the document or video structure.

This work must replace that embedded curation with a reproducible Claude Agent SDK ingestion pipeline. A new PDF or supported video should be ingestible without editing source code. Claude should inspect source text and pixels, write schema-validated manifests through controlled tools, and leave explicit provenance for every generated section, figure, table, and video segment.

This is an offline build pipeline. Generated knowledge remains committed so the grader's application startup stays fast and does not make ingestion API calls.

## Current-state audit

### PDF pipeline

`scripts/extract/extract.py` currently:

- knows the three OmniPro filenames through the `SOURCES` constant;
- contains manually encoded section titles, summaries, and page ranges in `SECTIONS`;
- contains manually encoded figure pages, normalized crop rectangles, captions, keywords, and example questions in `FIGURE_DEFS`;
- uses PyMuPDF to extract page text and render page PNGs;
- applies the fixed crop rectangles;
- writes `knowledge/index.json`, `knowledge/search-documents.json`, `knowledge/figures.json`, page assets, and figure assets.

The mechanical extraction is useful. Section and figure discovery are not implemented.

### Video pipeline

`scripts/video/extract.py` currently:

- contains one fixed YouTube id and source identity;
- fetches its English captions with `youtube-transcript-api`;
- contains fixed semantic ranges, summaries, keywords, and frame timestamps in `SEGMENTS`;
- downloads the source video with `yt-dlp` and extracts fixed frames with FFmpeg;
- writes `knowledge/video/transcript.json`, `segments.json`, and frame JPEGs.

Caption and frame extraction are automatic. Semantic segmentation is not.

### Runtime coupling that must also be removed

Generic ingestion will not be useful if runtime code still assumes the three current documents. In particular:

- `apps/server/src/evidence.ts` uses a fixed Zod enum for document source ids;
- `apps/server/src/knowledge.ts` loads fixed root-level JSON filenames and maps source ids to fixed display names and filenames;
- `apps/server/src/visual-spec.ts` restricts page asset ids to the current source ids;
- some tools and prompt language refer specifically to the current manuals;
- structured lookup functions load fixed product tables directly.

The OmniPro agent may retain product-specific deterministic calculators, but the base document/figure/video ingestion and retrieval layers must not depend on OmniPro ids.

## Outcome

After this project, the following command should ingest a new document package without source edits:

```bash
npm run ingest -- \
  --product omnipro-220 \
  --input files/owner-manual.pdf \
  --input files/quick-start-guide.pdf \
  --input files/selection-chart.pdf
```

Video ingestion should be similarly data-driven:

```bash
npm run ingest:video -- \
  --product omnipro-220 \
  --url https://www.youtube.com/watch?v=kxGDoGcnhBw
```

The commands should:

1. extract source text, pixels, and source metadata deterministically;
2. ask Claude to discover sections, useful figures, structured-data candidates, and video segments;
3. let Claude inspect and revise visual crops through previews;
4. validate all generated data and evidence references;
5. write a versioned knowledge package atomically;
6. record source hashes, model, prompt version, timestamps, and validation results;
7. exit non-zero and keep the previous valid package untouched if any required stage fails.

The normal application must load only the committed finalized package. It must not call Claude during startup.

## Non-goals

- Do not train or fine-tune a model.
- Do not add a database for ingestion. Files are the correct artifact boundary.
- Do not give the ingestion agent unrestricted filesystem or shell access.
- Do not require perfect OCR for scanned documents in the first implementation. If a page has no usable text, record that fact and let Claude inspect its page image. Do not silently invent text.
- Do not force every product to have specialized calculators such as duty cycle or polarity. Generic search, source display, and visual explanation must work without product adapters.
- Do not dynamically re-ingest documents during a user chat.
- Do not preserve the current hard-coded definitions merely by moving them unchanged into JSON. The OmniPro package must be regenerated from the source materials through the new pipeline.

## Design principles

1. **Deterministic extraction, model interpretation.** Code owns byte handling, PDF rendering, caption retrieval, hashing, validation, crops, and writes. Claude owns semantic interpretation.
2. **Controlled writes.** Claude submits structured values to narrow tools. The application validates and writes them; Claude never chooses filesystem paths.
3. **Pixels are evidence.** Figure discovery and crop approval require viewing the rendered page and a crop preview, not text-only guessing.
4. **No silent fallback.** A failed transcript request, model run, invalid crop, or invalid manifest is an explicit failed stage. The last valid finalized package remains intact.
5. **Generated does not mean untraceable.** Every semantic artifact records the source pages/timestamps and the ingestion run that created it.
6. **Idempotent builds.** The same source hashes, prompt version, model, and accepted manifests must produce identical derived assets apart from recorded run timestamps.
7. **Runtime and ingestion are separate.** The app consumes finalized artifacts; ingestion can be slower and API-backed.

## Target architecture

```text
Source files / URLs
        |
        v
Deterministic preparation
  - hashes
  - PDF metadata/outlines
  - page text + page PNGs
  - caption track
        |
        v
Staging workspace
  .arcwell/ingestion/<run-id>/
        |
        v
Claude Agent SDK ingestion runner
  - section analysis
  - figure candidates
  - crop preview/revision
  - table candidates
  - video segmentation
        |
        v
Schema + semantic validators
  - source/page/timestamp bounds
  - crop bounds/content density
  - evidence completeness
  - id uniqueness
  - asset existence
        |
        v
Atomic finalizer
        |
        v
knowledge/products/<product-id>/
  manifest.json
  search-documents.json
  pages/
  figures/
  tables/
  video/
        |
        v
Generic runtime knowledge loader
```

## Proposed repository layout

```text
scripts/ingest/
  cli.ts                    CLI entry point and orchestration
  prepare-pdf.py            Generic PyMuPDF byte/text/page extraction only
  prepare-video.py          Captions/download/frame mechanics only

apps/server/src/ingestion/
  schemas.ts                Zod schemas for configs, manifests, and stage output
  workspace.ts              Staging paths, source ids, hashing, atomic promotion
  source-reader.ts          Reads only registered staging sources
  tools.ts                  Controlled MCP tools exposed to ingestion Claude
  prompt.ts                 Product-independent ingestion instructions
  runner.ts                 Agent SDK query configuration and stage runner
  validate.ts               Cross-record and semantic validation
  materialize.ts            Crops, search docs, and final package generation
  types.ts

knowledge/products/
  omnipro-220/
    manifest.json
    search-documents.json
    pages/
    figures/
    tables/
    video/

.arcwell/ingestion/          Ignored staging/checkpoint data
```

Keeping the orchestration in TypeScript lets it reuse the existing Agent SDK and Zod patterns. Keep Python only for narrow media operations where PyMuPDF and the existing video packages are already effective.

## Input configuration

The CLI should create or accept a small input config. This config describes sources; it must not describe their semantic contents.

```json
{
  "schemaVersion": 1,
  "productId": "omnipro-220",
  "productName": "Vulcan OmniPro 220",
  "documents": [
    {
      "path": "files/owner-manual.pdf",
      "sourceId": "owner-manual",
      "authority": "authoritative-manual"
    },
    {
      "path": "files/quick-start-guide.pdf",
      "sourceId": "quick-start",
      "authority": "authoritative-quick-start"
    }
  ],
  "videos": [
    {
      "url": "https://www.youtube.com/watch?v=kxGDoGcnhBw",
      "sourceId": "setup-demo",
      "authority": "supplemental-demonstration",
      "captionLanguages": ["en"]
    }
  ]
}
```

`sourceId` can be supplied for stable links or derived safely from the filename/title. Titles, sections, figure descriptions, timestamps, and keywords must not be supplied here.

## Final manifest schema

Implement this as Zod first, then infer TypeScript types. The exact field names can evolve, but the information and provenance requirements are mandatory.

```json
{
  "schemaVersion": 1,
  "product": {
    "id": "omnipro-220",
    "name": "Vulcan OmniPro 220"
  },
  "documents": [
    {
      "id": "owner-manual",
      "title": "Vulcan OmniPro 220 Owner's Manual",
      "sourceFile": "owner-manual.pdf",
      "sha256": "...",
      "pageCount": 48,
      "authority": "authoritative-manual",
      "outlineAvailable": true
    }
  ],
  "sections": [
    {
      "id": "owner-manual:tig-setup",
      "documentId": "owner-manual",
      "title": "TIG setup",
      "startPage": 24,
      "endPage": 26,
      "summary": "DCEN routing, argon, foot pedal, torch, and tungsten preparation.",
      "headingEvidence": [
        { "page": 24, "text": "TIG Setup" }
      ],
      "generatedBy": "run-..."
    }
  ],
  "figures": [
    {
      "id": "owner-manual:tig-cable-setup",
      "documentId": "owner-manual",
      "page": 24,
      "title": "TIG cable and gas setup",
      "caption": "Ground positive, TIG torch negative, and argon supply routing.",
      "bounds": { "x1": 0.07, "y1": 0.1, "x2": 0.93, "y2": 0.92 },
      "keywords": ["TIG", "DCEN", "argon", "polarity"],
      "asset": "figures/owner-manual-tig-cable-setup.png",
      "previewHash": "...",
      "generatedBy": "run-..."
    }
  ],
  "datasets": [
    {
      "id": "duty-cycles",
      "title": "Published duty-cycle ratings",
      "schema": {
        "process": "string",
        "inputVoltage": "number",
        "amps": "number",
        "dutyPercent": "number"
      },
      "recordsFile": "tables/duty-cycles.json",
      "evidence": [{ "documentId": "owner-manual", "pages": [7, 23, 29] }],
      "generatedBy": "run-..."
    }
  ],
  "videos": [
    {
      "id": "setup-demo",
      "videoId": "kxGDoGcnhBw",
      "title": "Vulcan OmniPro 220 setup demonstration",
      "url": "https://www.youtube.com/watch?v=kxGDoGcnhBw",
      "captionType": "auto-generated",
      "transcriptFile": "video/setup-demo/transcript.json",
      "sha256": "...",
      "authority": "supplemental-demonstration"
    }
  ],
  "videoSegments": [
    {
      "id": "video:setup-demo@249-334",
      "videoId": "setup-demo",
      "title": "TIG setup, foot pedal, and lift start",
      "startSeconds": 249,
      "endSeconds": 334,
      "summary": "Torch preparation, tungsten, gas, pedal control, and lift-start sequence.",
      "keywords": ["TIG", "foot pedal", "lift start"],
      "frameSeconds": 260,
      "frame": "video/setup-demo/frames/tig-setup.jpg",
      "generatedBy": "run-..."
    }
  ],
  "ingestionRuns": [
    {
      "id": "run-...",
      "createdAt": "2026-07-19T00:00:00.000Z",
      "model": "claude-sonnet-4-6",
      "promptVersion": "ingestion-v1",
      "sourceHashes": { "owner-manual": "..." },
      "stages": [
        { "name": "sections", "status": "complete", "attempts": 1 },
        { "name": "figures", "status": "complete", "attempts": 2 }
      ]
    }
  ]
}
```

Do not include the current `answers` sample-question field in generated figure records. It biases retrieval toward a small hard-coded evaluation set. Search should use title, caption, keywords, surrounding text, and source metadata.

## Agent stages

Use multiple bounded stages rather than one enormous prompt. Each stage should resume its own Agent SDK session only when revision is required; do not depend on a single long conversation for the whole corpus.

### Stage 1: document identity and section discovery

Inputs:

- deterministic PDF metadata;
- PDF outline/bookmarks if present;
- page count;
- page text in bounded batches;
- page thumbnails when text or heading structure is ambiguous.

Outputs:

- document title;
- ordered sections with stable ids, page spans, summaries, and heading evidence.

Rules:

- use outline entries when they are meaningful, but verify their page bounds;
- infer headings from text/layout only when necessary;
- allow uncovered front/back-matter pages, but report them;
- allow nested sections in a future schema, but a flat ordered list is acceptable for v1;
- never describe content outside the section's pages.

### Stage 2: figure discovery and crop approval

Inputs:

- page thumbnails;
- page text blocks and their rectangles where available;
- embedded raster/vector object rectangles from PyMuPDF;
- discovered section context.

Outputs:

- figures that add visual value: diagrams, controls, charts, schematics, diagnosis images, and labeled mechanisms;
- normalized page bounds, title, caption, and retrieval keywords.

Workflow:

1. Claude requests candidate pages or pages returned by layout heuristics.
2. Claude inspects the full prepared page.
3. Claude submits a candidate crop.
4. `preview_figure_crop` returns the exact crop, page context, dimensions, content-density diagnostics, and a hash.
5. Claude accepts or revises it.
6. Only a valid, explicitly accepted preview hash can be saved.

This should reuse the lessons from `preview_visual_annotations`: invalid candidates must still return their pixels and issues so the model can revise visually. A failed candidate is an expected review result, not a tool exception. Bound attempts per figure and per page.

Do not crop every decorative image. Prefer assets that help answer or explain technical questions.

### Stage 3: structured-data candidate extraction

Claude identifies tables or matrices whose exact values benefit from deterministic lookup, such as ratings, polarity mappings, parts, or troubleshooting matrices.

Requirements:

- dataset schemas are generated as data, not TypeScript source;
- every record carries page evidence and, when possible, source-region coordinates;
- numbers must be transcribed from page pixels or native table text, never inferred;
- validation checks record ids, types, duplicates, ranges that follow directly from the declared schema, and referenced pages;
- extraction fails visibly when the source is unreadable;
- a verification stage should re-open the relevant page regions and compare the completed records against the source before promotion.

Generic runtime retrieval can expose arbitrary datasets. Specialized calculators may opt into a dataset through product-adapter configuration after ingestion.

### Stage 4: video semantic segmentation

Inputs:

- deterministic transcript with timestamps;
- video duration and metadata;
- on-demand frames requested by timestamp.

Outputs:

- ordered, non-empty semantic segments;
- titles, summaries, keywords, boundaries, and representative-frame timestamps.

Rules:

- segment boundaries must be within the transcript/video duration;
- segments should cover meaningful demonstrations rather than equal time slices;
- captions remain the searchable verbatim source; summaries are explicitly generated metadata;
- Claude previews the representative frame before accepting it;
- transcript API failure is an explicit stage failure. Do not silently switch providers.

### Stage 5: corpus validation and finalization

Run all validators after individual stages complete. Materialize derived crops and search documents only from the accepted manifest. Write to a temporary finalized directory and atomically rename it over the target package only after every required check passes.

## Controlled ingestion tools

Expose a separate MCP server to the ingestion agent. Do not reuse user-chat tools directly and do not expose arbitrary read/write operations.

Recommended tools:

### `list_ingestion_sources`

Returns registered document/video ids, page counts, source hashes, authority types, and stage status.

### `read_page_text`

Arguments: `documentId`, `startPage`, `endPage` with strict limits.

Returns exact extracted text and optional block geometry. Never accepts a path.

### `inspect_page_image`

Arguments: `documentId`, `page`, optional deterministic downscale.

Returns the exact prepared page pixels and dimensions as image content.

### `list_page_regions`

Returns deterministic embedded-image, drawing, and text-block rectangles from PyMuPDF. These are candidates, not semantic conclusions.

### `preview_figure_crop`

Arguments: `documentId`, `page`, normalized bounds, temporary label.

Returns:

- crop pixels;
- a reduced full-page context image with the crop rectangle;
- pixel and normalized dimensions;
- blank/content-density and bounds issues;
- `valid` and `previewHash`.

### `save_sections`

Accepts a complete section set for one document. Zod-validates it and records a stage checkpoint. It cannot promote the final package.

### `save_figure`

Accepts one figure plus the exact approved `previewHash`. Rejects stale or unpreviewed crops.

### `save_dataset`

Accepts a dataset definition and records with page/region evidence. Enforces size limits and schema validity.

### `read_transcript`

Returns bounded timestamp ranges from a registered video transcript.

### `inspect_video_frame`

Returns one frame at a bounded timestamp from a registered video source.

### `save_video_segments`

Accepts the complete ordered segment set and approved frame timestamps.

### `finalize_ingestion`

Runs validation and reports issues. The tool may mark the staging run ready, but orchestration code—not Claude—performs atomic promotion after the Agent SDK turn ends successfully.

All tool calls must be instrumented with stage, duration, success/error, token/cost totals where the SDK reports them, and source ids. Do not store source text in telemetry.

## Agent SDK runner

Follow the isolation pattern already used by the chat agent:

- use `@anthropic-ai/claude-agent-sdk`;
- select the model through `CLAUDE_INGESTION_MODEL`, defaulting to the project's configured Claude model;
- expose only the ingestion MCP server;
- disable Claude Code filesystem/settings inheritance;
- set bounded `maxTurns` and a per-stage maximum dollar budget;
- stream tool activity to CLI logs;
- buffer generated prose because the actual deliverable is tool-written structured state;
- require the stage's save/finalize tool before accepting success;
- allow one bounded repair turn containing only validation issues, not a supplied answer;
- abort and return non-zero if the repair fails.

Record the actual model id, cost, token usage, SDK turns, tool calls, failures, and prompt version in the run record.

## Deterministic preparation

Refactor `scripts/extract/extract.py` into a generic media preparation program. It should:

- accept one or more input paths and an output staging directory;
- compute SHA-256 before extraction;
- reject encrypted, malformed, or empty PDFs explicitly;
- record page count, media box, rotation, and outline/bookmarks;
- extract text plus text-block bounding boxes;
- list embedded raster and drawing bounds where PyMuPDF exposes them;
- render every page in a controlled coordinate space;
- never contain source filenames, sections, captions, keywords, crops, or product facts.

Refactor `scripts/video/extract.py` so it:

- accepts URL/source id/output path as arguments;
- retrieves the requested caption language through `youtube-transcript-api`;
- records transcript metadata and timestamps;
- provides an on-demand frame extraction command/function;
- never contains a video id, segment boundaries, summaries, keywords, or frame timestamps.

## Validation requirements

Implement validation as pure functions wherever possible.

### Documents and sections

- unique source and section ids;
- referenced pages exist;
- `startPage <= endPage`;
- section ordering is stable;
- heading evidence text occurs on the referenced page after normalization, or is explicitly marked visual-only;
- summaries are non-empty and bounded;
- report uncovered pages and suspicious overlaps.

### Figures

- document and page exist;
- normalized bounds are finite and inside `[0, 1]`;
- width and height exceed minimum useful thresholds;
- crop is not predominantly blank;
- crop is not effectively the entire page unless its declared type warrants it;
- approved preview hash matches the exact figure record;
- output asset exists and dimensions match the materialized crop;
- title/caption/keywords are bounded and non-empty;
- no duplicate or near-identical crop on the same page unless explicitly allowed.

### Structured datasets

- declared schema is supported and bounded;
- records conform to it;
- ids are unique;
- every record has evidence;
- evidence pages and regions exist;
- no `NaN`, infinity, or untyped numeric strings;
- referenced assets/datasets exist;
- verification status is recorded.

### Video

- transcript timestamps are monotonic and inside duration;
- segment start is less than end;
- segments are ordered and inside duration;
- segment transcript overlap is non-empty;
- frame timestamp is within its segment;
- extracted frame exists and is not blank;
- ids are derived consistently from source and boundaries.

### Package

- all referenced files exist;
- all paths are relative and remain inside the package;
- source hashes match staged inputs;
- search documents are derivable from the manifest/page text;
- no temporary paths or local absolute paths are serialized;
- the package passes the runtime loader before atomic promotion.

## Runtime generalization

### Evidence schemas

Replace the fixed `DocumentSourceIdSchema` enum with a validated id string, for example `/^[a-z0-9][a-z0-9-]{0,79}$/`. Resolve titles, filenames, authority, and URLs from the loaded product manifest rather than switch statements.

### Visual asset ids

Replace the fixed page-source regular expression with a generic parsed form such as `page:<product-id>:<document-id>:<page>`, or keep product scope outside the id if only one product is loaded per deployment. Validate the parsed ids against the active manifest rather than a compile-time source list.

### Knowledge loader

Refactor `apps/server/src/knowledge.ts` into:

- a generic package loader and validator;
- generic MiniSearch indexes for page, figure, video, and dataset metadata;
- the existing OmniPro lookup adapters, moved behind an optional product-specific module.

Select the active package through `KNOWLEDGE_PRODUCT_ID`, defaulting to `omnipro-220` for this challenge.

### Specialized product behavior

Duty-cycle, polarity, troubleshooting, and settings widgets benefit from deterministic structured lookups. Keep them for OmniPro, but load their records through manifest-declared dataset ids. A newly ingested product without those adapters should still support generic source-grounded answers and visuals; it simply will not advertise specialized calculators.

## Migration plan

### Phase 1: schemas and generic deterministic preparation

1. Add ingestion schemas and fixture tests.
2. Build staging workspace and atomic finalization helpers.
3. Split product-specific constants out of the current Python scripts.
4. Make PDF/video preparation accept CLI arguments.
5. Generate raw staged pages/transcripts without semantic metadata.

Exit condition: an arbitrary fixture PDF can be prepared without editing code.

### Phase 2: Claude section and figure agent

1. Add the ingestion MCP server.
2. Add section discovery tools and prompt.
3. Add page-image inspection and crop-preview tools.
4. Add bounded stage runner and repair behavior.
5. Save staging manifests and provenance.

Exit condition: Claude can produce valid sections and approved figures for an arbitrary fixture document using only registered tools.

### Phase 3: dataset and video extraction

1. Add generic dataset candidate/save/verification tools.
2. Convert current structured knowledge into generated datasets by re-ingesting the manuals; do not copy the old constants as the result.
3. Add transcript-range and frame-inspection tools.
4. Generate video segments through Claude.

Exit condition: no product facts, semantic video ranges, or figure definitions remain in extraction source code.

### Phase 4: runtime package loader

1. Generalize evidence ids and visual asset ids.
2. Load the selected product manifest.
3. Build generic search indexes from the package.
4. Adapt OmniPro deterministic tools to manifest datasets.
5. Maintain existing source links, figures, videos, annotations, and widgets.

Exit condition: the current chat application runs against `knowledge/products/omnipro-220/` with no functional regression.

### Phase 5: regenerate and compare OmniPro knowledge

1. Run the new pipeline from the original files and video URL.
2. Do not seed it with current `SECTIONS`, `FIGURE_DEFS`, or `SEGMENTS`.
3. Review generated coverage against the manual, not against exact legacy wording or crop coordinates.
4. Run unit, integration, live acceptance, and manual visual checks.
5. Commit the generated package and ingestion run provenance.
6. Delete the embedded constants and obsolete root-level knowledge layout.

Exit condition: deleting and regenerating the OmniPro package requires only the source config and Anthropic key.

## Files expected to change

At minimum:

- replace `scripts/extract/extract.py` with generic preparation or rename it to `scripts/ingest/prepare-pdf.py`;
- replace `scripts/video/extract.py` with generic transcript/frame preparation;
- add `scripts/ingest/cli.ts` and ingestion modules under `apps/server/src/ingestion/`;
- update root `package.json` commands;
- update `apps/server/src/evidence.ts`;
- update `apps/server/src/knowledge.ts` and its tests;
- update `apps/server/src/visual-spec.ts` and visual asset resolution;
- update tool schemas that assume fixed source ids;
- move generated knowledge under `knowledge/products/omnipro-220/`;
- update README architecture, ingestion instructions, and provenance language;
- add `.arcwell/ingestion/` to `.gitignore`.

Do not overwrite unrelated changes. The worktree is currently dirty from ongoing application development. Inspect `git status`, preserve user changes, and make narrow patches.

## Testing strategy

### Unit tests without an API key

- input config and manifest schema acceptance/rejection;
- safe id/path generation and traversal rejection;
- PDF preparation of a small checked-in fixture;
- source hashing and change detection;
- section page-bound validation;
- crop bounds, blank detection, preview hashing, and stale-hash rejection;
- dataset schema and evidence validation;
- video boundary and frame validation;
- atomic promotion leaves an old valid package untouched on failure;
- runtime package loader accepts the fixture package;
- generic evidence/source URLs resolve without compile-time ids;
- search indexes include generated page/figure/video metadata;
- idempotent materialization from a fixed accepted manifest.

Mock Agent SDK query events to test required tool calls, one repair attempt, budget enforcement, and failed-stage behavior.

### Live ingestion evaluation with an API key

Create a small evaluation corpus that is not the OmniPro manual used to author the implementation. It should include:

- a PDF with a real outline;
- a PDF without an outline but with visible headings;
- at least one useful labeled diagram;
- a decorative image that should not become a figure;
- a small numeric table;
- a page dominated by whitespace;
- optionally, a short captioned video.

Evaluate semantic properties rather than exact generated wording:

- major sections found and page bounds reasonable;
- useful figure crop overlaps the labeled diagram;
- decorative image omitted;
- crop contains its declared subject;
- table values match the source;
- every artifact has valid evidence;
- video segments cover meaningful topics and frames fall inside them;
- second run with unchanged inputs produces equivalent semantic output.

### OmniPro regression evaluation

- marquee duty-cycle and polarity answers remain exact;
- troubleshooting continues to filter process-specific advice;
- front-panel, interior-control, polarity, diagnosis, duty-cycle, wiring, and parts visuals remain retrievable;
- video sources retain bounded timestamps;
- user-photo annotation continues to use manual evidence;
- source links and the Sources drawer still resolve;
- current unit suite, typecheck, build, and live acceptance evaluation pass.

## Acceptance criteria

The implementation is complete only when all of these are true:

- No `SECTIONS`, `FIGURE_DEFS`, product video id, or semantic `SEGMENTS` constant exists in executable extraction code.
- Adding a fixture PDF requires no TypeScript or Python source edit.
- Claude Agent SDK, not a hidden static manifest, generates section/figure/video semantics.
- Every accepted figure was visually previewed and hash-approved.
- Every generated semantic artifact records source evidence and ingestion-run provenance.
- Invalid or incomplete ingestion exits non-zero and does not replace the last valid package.
- The generated package is committed and normal startup performs no ingestion API calls.
- Runtime source ids and page assets are validated against the manifest, not fixed enums/regex alternatives.
- The OmniPro application retains its existing grounded text, figures, video, visual specs, widgets, and photo diagnostics.
- README accurately distinguishes deterministic extraction, Claude-generated metadata, validation, and optional human review.
- `npm run typecheck`, `npm test`, `npm run build`, and the live ingestion evaluation pass.

## Recommended implementation order for the next agent

1. Read this document and inspect the current dirty worktree before editing.
2. Add schemas, fixtures, and package validation first.
3. Implement generic raw preparation and prove it on the fixture.
4. Implement section discovery with mocked Agent SDK tests.
5. Implement figure discovery and preview approval.
6. Add dataset extraction and verification.
7. Generalize and agent-drive video segmentation.
8. Generalize runtime package loading and evidence ids.
9. Regenerate OmniPro from source without seeding legacy metadata.
10. Run regression/evaluation suites and update README.

Do not start by moving the existing constants into JSON. That would change the storage format without solving the problem.

## Handoff summary

The existing scripts should not be thrown away wholesale: their deterministic PDF rendering, text extraction, caption retrieval, and frame/crop materialization are useful. Their semantic constants must be removed. The replacement is a generic staged ingestion system in which Claude inspects text and pixels through controlled tools, writes validated JSON manifests, and cannot promote an invalid package. The runtime then consumes those generated packages generically, with OmniPro-specific calculators retained only as optional adapters over generated structured datasets.
