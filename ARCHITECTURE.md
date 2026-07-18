# Architecture — Vulcan OmniPro 220 Multimodal Agent

A multimodal reasoning agent for the Vulcan OmniPro 220 welder, built on the
Anthropic Claude Agent SDK. The agent answers deep technical questions about
the machine and responds with more than text: real manual figures, live SVG
diagrams, and generated interactive artifacts.

## System overview

```
┌────────────────────────────────────────────────────────────┐
│  apps/web  (Vite + React chat UI)                          │
│  message parts: text │ figure │ widget │ artifact(iframe)  │
└──────────────▲─────────────────────────────────────────────┘
               │ SSE (typed events)
┌──────────────┴─────────────────────────────────────────────┐
│  apps/server  (Node + Hono, Claude Agent SDK loop)         │
│  tools: search_manual, read_pages, lookup_*, show_figure,  │
│         render_artifact, widget tools                      │
└──────────────▲─────────────────────────────────────────────┘
               │ reads (no runtime ingestion)
┌──────────────┴─────────────────────────────────────────────┐
│  knowledge/  (committed, built once by scripts/extract)    │
│  pages/ figures/ tables/ index.json                        │
└────────────────────────────────────────────────────────────┘
```

Three layers, one repo, one `npm install && npm run dev`, one API key.

## 1. Knowledge base (built offline, committed to the repo)

A one-time extraction pipeline (`scripts/extract/`) processes the three PDFs
(48-page owner's manual, 2-page quick start, 1-page selection chart) into a
structured knowledge base. The pipeline itself uses Claude for figure
labeling and table transcription. Its output is **committed**, so graders
never run ingestion — the 2-minute setup budget is spent only on
`npm install`.

```
knowledge/
  pages/            page-01.png … page-51.png   (full-page renders, pdftoppm)
                    page-01.txt … page-51.txt   (per-page extracted text)
  figures/          <figure-id>.png             (cropped images from the PDFs)
                    figures.json                (catalog, see below)
  tables/           specs.json                  (per-process spec tables, p7)
                    duty_cycles.json            (process × voltage × amps)
                    synergic_settings.json      (process × material × thickness
                                                 → wire speed / voltage / amps)
                    polarity.json               (process → torch/ground socket,
                                                 gas required, electrode notes)
                    troubleshooting.json        (symptom → causes → fixes)
                    weld_diagnosis.json         (defect → figure-id → causes)
                    parts.json                  (parts list + diagram refs)
  index.json        manual map: section → pages → one-line summaries
```

`figures.json` entry shape:

```json
{
  "id": "front-panel-controls",
  "title": "Front Panel Controls",
  "source": "owner-manual",
  "pages": [8],
  "file": "figures/front-panel-controls.png",
  "caption": "Labeled diagram of the front panel …",
  "keywords": ["sockets", "polarity", "LCD", "power switch"],
  "answers": ["Which socket does the ground clamp go in?", "…"]
}
```

Design rules:

- **Every numeric fact lives in a table JSON.** Duty cycles, synergic
  settings, specs — deterministic lookups, never recalled from model memory.
- **Every visual fact lives in the figure library** with enough metadata
  (keywords + example questions) that keyword search finds it.
- **Page images are the ground truth.** When precision matters or a question
  falls outside the structured data, the agent re-reads the actual pixels.
- Table JSONs record their source pages so every answer can cite the manual.

## 2. Agent layer (Claude Agent SDK, server-side)

One Agent SDK session per conversation, running in `apps/server`. The system
prompt permanently carries:

- the compact manual map (`index.json`) so the agent always knows where to look,
- the persona: patient expert helping a competent non-welder in their garage —
  practical, safety-aware, never condescending,
- clarification policy: ask before answering when an answer depends on
  unstated state (input voltage 120V vs 240V, process, material, wire type),
- response-mode policy: numbers → lookup tool + widget; spatial/physical →
  figure or SVG; procedures → steps interleaved with figures; "it depends" →
  interactive artifact.

### Tools

**Retrieval (model-facing):**

| Tool | Behavior |
|---|---|
| `search_manual(query)` | Keyword search (MiniSearch, no vector DB) over page text + figure metadata; returns snippets with page numbers and figure ids |
| `read_pages(pages[])` | Injects full-page PNGs into model context — the accuracy backstop for tables/diagrams |

**Structured lookups (deterministic, model-facing):**

| Tool | Backing data |
|---|---|
| `lookup_duty_cycle(process, voltage, amps)` | `duty_cycles.json` |
| `lookup_settings(process, material, thickness, wire?)` | `synergic_settings.json` |
| `lookup_polarity(process)` | `polarity.json` |
| `lookup_troubleshooting(symptom)` | `troubleshooting.json` + `weld_diagnosis.json` |
| `get_specs(process?)` | `specs.json` |
| `search_parts(query)` | `parts.json` |

**Presentation (UI-facing — emit SSE events rendered in chat):**

| Tool | Renders as |
|---|---|
| `show_figure(id, caption?)` | The actual manual image, inline in chat |
| `show_widget(name, params)` | A prebuilt interactive React component (Tier 1) |
| `render_artifact(title, html)` | Sandboxed iframe running generated HTML (Tier 2) |

Lookup tools return exact matches *and* nearest neighbors (e.g. requested
amperage between table rows) with an explicit flag, so the agent interpolates
honestly instead of silently.

## 3. Multimodal output — two tiers

### Tier 1: Prebuilt parameterized widgets

Hand-built, polished React components invoked via `show_widget`, guaranteed
correct and pretty for the questions graders will definitely ask:

1. **Duty cycle calculator** — process/voltage/amps → % duty cycle, weld vs
   rest minutes, animated 10-minute clock (mirrors the selection chart's own
   graphic).
2. **Settings configurator** — process + material + thickness → recommended
   wire speed / voltage / amperage from the synergic tables.
3. **Polarity hookup diagram** — SVG of the front panel; agent passes
   `process`, correct cable routing highlights (torch → socket, ground →
   socket, gas on/off). Directly answers the marquee polarity question.
4. **Troubleshooting flowchart** — interactive decision tree driven by
   `troubleshooting.json`, linking to weld-diagnosis figures.

### Tier 2: Generated artifacts (raw HTML from Claude)

For novel questions, the agent writes a complete single-file HTML document
(inline CSS/JS, no external resources) via `render_artifact`.

- **Sandboxing:** rendered in `<iframe sandbox="allow-scripts" srcDoc=…>` —
  no same-origin, no top navigation, no network (strict CSP meta tag injected
  into the document).
- **Auto-fix loop:** the iframe wraps `window.onerror` /
  `unhandledrejection` and reports failures via `postMessage`; the frontend
  relays errors to the server, which feeds them back to the agent as a tool
  error for a repair pass (max 2 retries) before falling back to a text
  answer. Malformed/blank renders surface a "Regenerate" affordance.
- **Style guide:** the prompt includes design tokens (colors, spacing, fonts)
  so generated artifacts match the app's look; dark/light aware.

## 4. Frontend & runtime

- **Layout:** npm workspaces — `apps/server` (Node 20+, Hono, Agent SDK,
  TypeScript) and `apps/web` (Vite + React + TypeScript). Root
  `npm run dev` runs both via `concurrently`; server serves the built web
  bundle in production so hosting is a single process.
- **Streaming:** SSE with typed events:
  `text_delta`, `tool_start`, `tool_end`, `figure`, `widget`, `artifact`,
  `clarification`, `error`, `done`. Text streams progressively; figures and
  widgets pop in as their tool calls resolve.
- **Chat model:** messages are arrays of typed parts, so a single answer can
  interleave prose, a manual figure, and a widget.
- **Static serving:** `knowledge/figures` and `knowledge/pages` are served
  as static assets; `show_figure` events just carry URLs.
- **Config:** exactly one env var, `ANTHROPIC_API_KEY`, read from `.env`.

Setup contract (the graders' path):

```bash
cp .env.example .env   # add API key
npm install
npm run dev            # web on :5173 proxying server on :3000
```

## 5. Build order

1. **Extraction pipeline + knowledge base** (`scripts/extract`) — pages,
   figures, tables, index; commit output. Spot-check every table JSON
   against the page PNGs.
2. **Server + agent loop** — SSE endpoint, retrieval + lookup tools, system
   prompt; validate the three sample questions in a CLI harness before any UI.
3. **Chat frontend** — streaming chat with text + figure parts.
4. **Tier 1 widgets** — polarity diagram first (marquee question), then duty
   cycle calculator, settings configurator, flowchart.
5. **Tier 2 artifacts** — sandbox iframe, error relay, auto-fix loop.
6. **Polish** — README, eval script over ~20 hard questions, hosting.
   (Stretch goals — voice, photo weld diagnosis, guided setup wizard — come
   after this list is done.)

## Acceptance criteria

- The three sample questions from the challenge spec answer correctly, each
  with an appropriate visual (duty cycle table/widget, diagnosis figures,
  polarity diagram).
- Numeric answers always trace to a table JSON or a `read_pages` citation —
  no free-recalled numbers.
- Ambiguous questions (e.g. duty cycle without voltage stated) trigger a
  clarifying question, not a guess.
- Fresh clone runs in under 2 minutes with only an API key.
