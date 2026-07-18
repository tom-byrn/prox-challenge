# Arcwell — OmniPro 220 field guide

Arcwell is a visual, source-grounded support agent for the Vulcan OmniPro 220 welder. It uses the [Anthropic Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) to reason over the supplied owner’s manual, quick-start guide, and process-selection chart, then answers with the medium that makes the task easiest to execute: concise prose, an actual manual figure, a deterministic interactive widget, or a sandboxed generated artifact.

![Arcwell showing the TIG polarity diagram and source figure](docs/arcwell-polarity.png)

## Run it

Requirements: Node.js 20 or newer and one Anthropic API key.

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The web app proxies its API and source assets to the server on port 3000.

That is the complete grader path. PDF extraction is deliberately not part of startup; its checked-in output is ready to use.

For a production-style local run:

```bash
npm run build
npm start
# Open http://localhost:3000
```

## What to try

- “What’s the duty cycle for MIG welding at 200A on 240V?”
- “I’m getting porosity in my flux-cored welds. What should I check?”
- “What polarity setup do I need for TIG? Which socket gets the ground clamp?”
- “My wire feeds, but I can’t strike an arc.”
- “Show me which feed-roller groove to use for 0.035 flux-cored wire.”
- “Can this machine TIG weld aluminum?”

The first three are also available as one-click prompts on the welcome screen.

## Architecture

```text
apps/web  (Vite + React)
  typed chat parts: markdown · source figure · widget · artifact iframe
                          │
                          │ POST + SSE
                          ▼
apps/server  (Hono + Claude Agent SDK)
  isolated Agent SDK session · in-process MCP tools · typed UI events
                          │
                          │ reads committed assets only
                          ▼
knowledge/
  51 page images + text · 19 curated figures · exact JSON lookups
```

Each browser conversation resumes an Agent SDK session by its SDK session id. The SDK is intentionally isolated from Claude Code’s filesystem tools and local settings: it receives only the OmniPro MCP tool server, a product-specific system prompt, and a bounded turn/cost budget.

The server streams typed SSE events. Text arrives progressively, while figures and widgets appear as soon as their presentation tool finishes. A response can therefore contain a direct answer, an interactive control, and primary-source evidence in one message.

### Agent tools

| Tool | Purpose |
|---|---|
| `search_manual` | MiniSearch over page text and curated figure metadata |
| `read_manual_pages` | Up to two exact pages as extracted text plus page pixels for visual verification |
| `lookup_duty_cycle` | Exact published duty-cycle points; never interpolates |
| `lookup_polarity` | Process → polarity, socket routing, gas, and source pages |
| `lookup_troubleshooting` | Symptom matching across troubleshooting and weld-diagnosis data |
| `get_specs` | Published process ranges, materials, wire sizes, and capacities |
| `get_settings_guide` | Source-honest LCD/setup guidance without invented synergic values |
| `search_parts` | Number/name search over the 61-part list |
| `show_figure` | Emits a real manual crop into chat |
| `show_widget` | Emits one of four deterministic React widgets |
| `render_artifact` | Emits constrained, inline-only HTML for a novel interactive explanation |

## Multimodal output

Four prebuilt widgets cover the high-value, accuracy-sensitive flows:

1. **Duty-cycle clock** — shows the exact rating, weld/rest minutes, and an animated ten-minute window. An unpublished amperage displays nearby certified points instead of a made-up estimate.
2. **Polarity hookup** — draws the negative and positive output sockets and routes each process lead to the right one, alongside the real quick-start figure.
3. **Troubleshooting checklist** — turns the relevant matrix row into an interactive sequence while filtering process-specific advice. For example, self-shielded flux-cored porosity does not show MIG-only gas checks.
4. **Settings guide** — explains the inputs the machine asks for, supported materials/wire sizes, and how to use the LCD’s recommended marks and a scrap test.

For questions that genuinely need a new interaction, Claude can call `render_artifact`. Generated documents run in `<iframe sandbox="allow-scripts">` without `allow-same-origin`. The frontend injects a strict CSP that blocks network, frames, forms, storage, external images, and external fonts. Runtime failures surface a repair affordance. The server also rejects common network, storage, and embedding primitives before emitting an artifact.

## Knowledge extraction and provenance

The committed `knowledge/` directory is produced by `scripts/extract/extract.py` using PyMuPDF. It renders every PDF page at 144 DPI, extracts per-page text, crops the figure library using reviewed page coordinates, and writes the manual map and search documents.

To rebuild it (not required to run the app):

```bash
python3 -m venv .venv-extract
.venv-extract/bin/pip install -r scripts/extract/requirements.txt
.venv-extract/bin/python scripts/extract/extract.py
```

The structured data under `knowledge/tables/` was transcribed and spot-checked against rendered page pixels:

- `duty_cycles.json` — 18 published points across MIG, TIG, stick, 120 V, and 240 V
- `specs.json` — process ranges, inputs, supported materials, and wire capacities
- `polarity.json` — MIG, self-shielded flux-cored, TIG, and stick routing
- `troubleshooting.json` and `weld_diagnosis.json` — symptom/cause/action data with figure ids
- `settings_guide.json` — documented LCD inputs and machine limitations
- `parts.json` — all 61 numbered parts and diagram references

Every lookup result carries manual page provenance. The model is instructed to cite those pages and to use a lookup or exact page read for every operational number.

## Two deliberate accuracy decisions

### Duty cycle is not interpolated

The manual certifies discrete operating points. Treating values between those points as a smooth curve would produce a plausible but unsupported safety limit. Arcwell returns an exact rating or explicitly says that the requested point is unpublished and shows the nearest published ratings.

For the sample question, the certified answer is **25% at 200 A on 240 V for MIG: 2.5 minutes welding and 7.5 minutes resting in each ten-minute period** (Owner’s Manual, pp. 7, 14, and 23).

### There is no published synergic output table

The supplied documents explain how to choose wire diameter/material thickness and how the LCD indicates its recommended wire-speed and voltage starting points. They do not publish a complete thickness → wire speed / voltage matrix or the machine’s internal synergic algorithm. Arcwell does not pretend otherwise. Its settings widget validates documented inputs, explains the screen workflow, and directs the user to a same-thickness scrap test instead of fabricating precise numbers.

This also catches a subtle source conflict: the generic selection chart describes AC TIG aluminum in general, but the OmniPro 220 specifications list DC TIG materials only. Machine-specific documentation wins, so Arcwell does not claim this welder can AC TIG aluminum.

## Safety model

- Clarify input voltage, process, or wire/electrode type when it changes the answer.
- Keep gas-shielded MIG and self-shielded flux-cored advice distinct.
- Surface the manual’s disconnect-power, ventilation, PPE, cylinder, and cooling rules in context.
- Do not turn the wiring schematic into casual internal-repair instructions; the manual limits that work to qualified technicians.
- Prefer a source figure for spatial claims and exact page pixels as the final retrieval backstop.

Arcwell is a manual navigation and reasoning aid, not a replacement for training, the product manual, or a qualified welding/electrical professional.

## Repository map

```text
apps/
  server/src/       Agent SDK loop, MCP tools, SSE API, deterministic lookups
  web/src/          chat UI, stream parser, source figures, widgets, artifact sandbox
knowledge/
  pages/            51 committed page PNG/TXT pairs
  figures/          reviewed visual crops
  tables/           exact structured product data
  index.json        compact section → page map for the system prompt
scripts/extract/    reproducible offline PDF build
files/              original supplied PDFs
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The unit suite locks the marquee numeric and polarity answers, the non-interpolation rule, process-specific porosity filtering, and figure/parts resolution. The UI was also exercised in a real browser at desktop and mobile widths, including streamed duty-cycle and TIG-polarity responses, source image loading, interactive controls, framework overlays, and console errors.

Set `CLAUDE_MODEL` in `.env` only if you need to override the default `claude-sonnet-4-6` model.
