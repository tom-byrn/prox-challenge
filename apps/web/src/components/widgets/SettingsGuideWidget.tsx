import { Gauge, Info, Layers3 } from "lucide-react";

type SettingsData = {
  accuracyNote?: string;
  mode: {
    process: string;
    inputs: string[];
    machineBehavior: string;
    supportedMaterials: string[];
    unsupportedNote?: string;
    wireDiameterIn?: number[];
  };
  pages?: number[];
};

function isSettingsData(data: unknown): data is SettingsData {
  return Boolean(data && typeof data === "object" && (data as { mode?: unknown }).mode);
}

export function SettingsGuideWidget({ data }: { data: unknown }) {
  if (!isSettingsData(data)) return <section className="widget"><p>Settings guidance is unavailable.</p></section>;
  return (
    <section className="widget settings-widget">
      <div className="widget-heading">
        <div className="widget-icon"><Gauge size={19} /></div>
        <div><span className="eyebrow">Machine-guided setup</span><h3>{data.mode.process.replace("_", "-")} starting point</h3></div>
      </div>
      <div className="settings-grid">
        <div>
          <span className="settings-label"><Layers3 size={15} /> Set these on the LCD</span>
          <ol>{data.mode.inputs.map((input) => <li key={input}>{input}</li>)}</ol>
        </div>
        <div>
          <span className="settings-label">Supported materials</span>
          <div className="material-tags">{data.mode.supportedMaterials.map((material) => <span key={material}>{material}</span>)}</div>
          {data.mode.wireDiameterIn ? <small className="wire-sizes">Wire: {data.mode.wireDiameterIn.map((size) => `${size.toFixed(3)}″`).join(" · ")}</small> : null}
        </div>
      </div>
      <p className="machine-behavior">{data.mode.machineBehavior}</p>
      <div className="accuracy-callout"><Info size={16} /><span>{data.mode.unsupportedNote ?? "The white marks on the LCD are the machine’s recommended starting point. The supplied manual does not publish the full numeric synergic table."}</span></div>
    </section>
  );
}
