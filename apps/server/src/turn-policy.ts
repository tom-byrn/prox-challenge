import type { Process, WidgetPayload } from "./types.js";
import type { VisualKind } from "./visual-spec.js";

export type VisualRequirement =
  | { type: "widget"; name: WidgetPayload["name"] }
  | { type: "figure" }
  | { type: "visual"; kinds?: VisualKind[] }
  | { type: "presentation" };

export type TurnPolicy = {
  requiredTools: string[];
  requiredVisuals: VisualRequirement[];
  requireCitation: boolean;
  allowClarification: boolean;
};

export function processFromMessage(message: string): Process | undefined {
  if (/\b(?:self[-\s]?shielded\s+)?flux[-\s]?core(?:d)?\b|\bfcaw(?:-s)?\b|\bgasless\b/i.test(message)) return "FLUX_CORED";
  if (/\bmig\b|\bgmaw\b|\bsolid[-\s]?wire\b/i.test(message)) return "MIG";
  if (/\btig\b|\bgtaw\b|\blift[-\s]?tig\b/i.test(message)) return "TIG";
  if (/\bstick\b|\bsmaw\b|\belectrode holder\b/i.test(message)) return "STICK";
  return undefined;
}

export function inputVoltageFromMessage(message: string): 120 | 240 | undefined {
  const match = message.match(/\b(120|240)\s*(?:v(?:olts?)?|[-\s]volt(?:s)?)\b|\binput\s+(?:power\s+)?(?:of\s+)?(120|240)\b/i);
  const value = match?.[1] ?? match?.[2];
  return value === "120" ? 120 : value === "240" ? 240 : undefined;
}

export function ampsFromMessage(message: string): number | undefined {
  const match = message.match(/\b(\d+(?:\.\d+)?)\s*(?:a|amps?|amperes?)\b/i);
  if (!match) return undefined;
  const amps = Number(match[1]);
  return Number.isFinite(amps) && amps > 0 ? amps : undefined;
}

function isDutyCycleQuestion(message: string): boolean {
  return /\bduty\s*cycle\b|\bhow long\b.{0,80}\b(?:weld|run)\b|\b(?:weld|run)\b.{0,80}\b(?:rest|cool(?:ing)?|ten[-\s]?minute)\b/i.test(message);
}

function isPolarityQuestion(message: string): boolean {
  return /\bpolarity\b|\b(?:ground|work) clamp\b|\bwhich socket\b|\b(?:cable|lead) (?:setup|hookup|routing)\b|\bwhere\b.{0,60}\b(?:plug|connect|socket)\b/i.test(message);
}

function isDefectQuestion(message: string): boolean {
  return /\bporosity\b|\bpinholes?\b|\bholes?\s+in\s+(?:my\s+)?(?:weld|bead)\b|\b(?:weld|bead)\b.{0,50}\b(?:defect|crack|spatter|undercut|distort|bad|wrong)\b/i.test(message);
}

function isSettingsQuestion(message: string): boolean {
  return /\b(?:wire speed|synergic|material thickness|recommended settings?|starting settings?)\b|\b(?:what|which) settings?\b|\bsettings?\s+(?:should|for)\b/i.test(message);
}

function isPartsQuestion(message: string): boolean {
  return /\bpart(?:s)?(?:\s+(?:number|list|diagram))?\b|\breplacement\b/i.test(message);
}

function isProductQuestion(message: string): boolean {
  return /\b(?:welder|welding|weld|mig|gmaw|tig|gtaw|stick|smaw|flux|fcaw|wire|gun|clamp|socket|duty|voltage|amperage|amps?|aluminum|steel|gas|roller|liner|contact tip|panel|display|part|manual|setting|setup|arc|bead|porosity|spatter|electrode|tungsten|omnipro)\b/i.test(message);
}

function asksForVisual(message: string): boolean {
  return /\b(?:show|draw|diagram|schematic|visual|picture|image|interactive|calculator|flowchart|walkthrough)\b/i.test(message);
}

function relatesToManualFigure(message: string): boolean {
  return /\b(?:feed roller|wire feed|front panel|interior controls?|wiring schematic|assembly diagram|weld diagnosis|which groove|where is)\b/i.test(message);
}

function addUnique(items: string[], item: string) {
  if (!items.includes(item)) items.push(item);
}

export function getTurnPolicy(message: string): TurnPolicy {
  const requiredTools: string[] = [];
  const requiredVisuals: VisualRequirement[] = [];
  const productQuestion = isProductQuestion(message);
  const dutyCycleQuestion = isDutyCycleQuestion(message);
  const polarityQuestion = isPolarityQuestion(message);
  const defectQuestion = isDefectQuestion(message);
  const settingsQuestion = !dutyCycleQuestion && !polarityQuestion && isSettingsQuestion(message);

  if (dutyCycleQuestion) {
    const missing: string[] = [];
    if (!processFromMessage(message)) missing.push("welding process");
    if (!ampsFromMessage(message)) missing.push("output amperage");
    if (!inputVoltageFromMessage(message)) missing.push("input voltage (120 V or 240 V)");
    if (missing.length > 0) {
      return {
        requiredTools: ["request_clarification"],
        requiredVisuals: [],
        requireCitation: false,
        allowClarification: true
      };
    }
    addUnique(requiredTools, "lookup_duty_cycle");
    requiredVisuals.push({ type: "widget", name: "duty_cycle" });
  }

  if (polarityQuestion) {
    if (!processFromMessage(message)) {
      return {
        requiredTools: ["request_clarification"],
        requiredVisuals: [],
        requireCitation: false,
        allowClarification: true
      };
    }
    addUnique(requiredTools, "lookup_polarity");
    requiredVisuals.push({ type: "visual", kinds: ["connection-diagram"] }, { type: "figure" });
  }

  if (defectQuestion) {
    addUnique(requiredTools, "lookup_troubleshooting");
    requiredVisuals.push({ type: "widget", name: "troubleshooting" }, { type: "figure" });
  }

  if (settingsQuestion) {
    if (!processFromMessage(message)) {
      return {
        requiredTools: ["request_clarification"],
        requiredVisuals: [],
        requireCitation: false,
        allowClarification: true
      };
    }
    addUnique(requiredTools, "get_settings_guide");
    requiredVisuals.push({ type: "widget", name: "settings_guide" });
  }

  if (isPartsQuestion(message)) addUnique(requiredTools, "search_parts");
  if (relatesToManualFigure(message) && !requiredVisuals.some((requirement) => requirement.type === "figure")) {
    requiredVisuals.push({ type: "figure" });
  }
  if (/\b(?:walkthrough|step[-\s]?by[-\s]?step)\b/i.test(message)) requiredVisuals.push({ type: "visual", kinds: ["procedure"] });
  if (/\b(?:compare|comparison|versus|\bvs\.?)\b/i.test(message)) requiredVisuals.push({ type: "visual", kinds: ["comparison"] });
  if (asksForVisual(message)) requiredVisuals.push({ type: "presentation" });

  if (productQuestion && requiredTools.length === 0) addUnique(requiredTools, "any_grounding_tool");

  return {
    requiredTools,
    requiredVisuals,
    requireCitation: productQuestion,
    allowClarification: !dutyCycleQuestion && !polarityQuestion
  };
}
