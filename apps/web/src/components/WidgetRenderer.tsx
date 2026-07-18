import type { WidgetPayload } from "../types";
import { DutyCycleWidget } from "./widgets/DutyCycleWidget";
import { PolarityWidget } from "./widgets/PolarityWidget";
import { SettingsGuideWidget } from "./widgets/SettingsGuideWidget";
import { TroubleshootingWidget } from "./widgets/TroubleshootingWidget";

export function WidgetRenderer({ widget }: { widget: WidgetPayload }) {
  if (widget.name === "duty_cycle") return <DutyCycleWidget data={widget.data} />;
  if (widget.name === "polarity") return <PolarityWidget data={widget.data} />;
  if (widget.name === "troubleshooting") return <TroubleshootingWidget data={widget.data} />;
  return <SettingsGuideWidget data={widget.data} />;
}
