import type { WidgetPayload } from "../types";
import { DutyCycleWidget } from "./widgets/DutyCycleWidget";
import { PolarityWidget } from "./widgets/PolarityWidget";
import { SettingsGuideWidget } from "./widgets/SettingsGuideWidget";
import { TroubleshootingWidget } from "./widgets/TroubleshootingWidget";

type Props = {
  widget: WidgetPayload;
  onStepHelp: (stepNumber: number) => void;
  stepHelpDisabled: boolean;
};

export function WidgetRenderer({ widget, onStepHelp, stepHelpDisabled }: Props) {
  if (widget.name === "duty_cycle") return <DutyCycleWidget data={widget.data} />;
  if (widget.name === "polarity") return <PolarityWidget data={widget.data} />;
  if (widget.name === "troubleshooting") return <TroubleshootingWidget data={widget.data} onStepHelp={onStepHelp} helpDisabled={stepHelpDisabled} />;
  return <SettingsGuideWidget data={widget.data} />;
}
