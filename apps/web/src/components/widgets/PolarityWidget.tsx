import { Cable, CircleCheck, Wind } from "lucide-react";

type PolarityData = {
  process: string;
  polarity: string;
  polarityMeaning: string;
  groundClampSocket: "positive" | "negative";
  electrodeLead: string;
  electrodeSocket: "positive" | "negative";
  gas: string;
  wireFeedConnected?: boolean;
  extraConnections?: string[];
  caution?: string;
  pages?: { ownerManual?: number[]; quickStart?: number[] };
};

function isPolarityData(data: unknown): data is PolarityData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<PolarityData>;
  return Boolean(candidate.process && candidate.polarity && candidate.groundClampSocket && candidate.electrodeSocket);
}

export function PolarityWidget({ data }: { data: unknown }) {
  if (!isPolarityData(data)) return <section className="widget"><p>Polarity data is unavailable.</p></section>;
  const negativeLead = data.groundClampSocket === "negative" ? "Ground clamp" : data.electrodeLead;
  const positiveLead = data.groundClampSocket === "positive" ? "Ground clamp" : data.electrodeLead;
  const processLabel = data.process === "FLUX_CORED" ? "Self-shielded flux-cored" : data.process;

  return (
    <section className="widget polarity-widget" aria-label={`${processLabel} cable hookup`}>
      <div className="widget-heading">
        <div className="widget-icon"><Cable size={19} /></div>
        <div><span className="eyebrow">Cable routing · {data.polarity}</span><h3>{processLabel} hookup</h3></div>
        <span className="verified-pill"><CircleCheck size={14} /> Manual verified</span>
      </div>

      <div className="polarity-layout">
        <div className="panel-diagram">
          <svg viewBox="0 0 520 300" role="img" aria-label={`Negative socket to ${negativeLead}; positive socket to ${positiveLead}`}>
            <defs>
              <filter id="socket-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="5" floodOpacity=".25" /></filter>
            </defs>
            <rect x="80" y="20" width="360" height="170" rx="24" fill="#262723" stroke="#575950" strokeWidth="3" />
            <rect x="118" y="48" width="124" height="64" rx="8" fill="#11120f" stroke="#3f413b" strokeWidth="2" />
            <text x="180" y="77" fill="#e8e5db" fontSize="13" textAnchor="middle">OMNIPRO 220</text>
            <text x="180" y="97" fill="#8e9187" fontSize="11" textAnchor="middle">OUTPUT PANEL</text>
            <g filter="url(#socket-shadow)">
              <circle cx="285" cy="123" r="31" fill="#181916" stroke="#7f8278" strokeWidth="6" />
              <circle cx="375" cy="123" r="31" fill="#181916" stroke="#7f8278" strokeWidth="6" />
            </g>
            <text x="285" y="131" fill="#f4f1e8" fontSize="28" fontWeight="700" textAnchor="middle">−</text>
            <text x="375" y="132" fill="#f4f1e8" fontSize="25" fontWeight="700" textAnchor="middle">+</text>
            <path d="M285 153 C285 202 205 208 178 254" fill="none" stroke={negativeLead === "Ground clamp" ? "#7eb6c4" : "#f36b2b"} strokeWidth="10" strokeLinecap="round" />
            <path d="M375 153 C375 202 400 212 424 254" fill="none" stroke={positiveLead === "Ground clamp" ? "#7eb6c4" : "#f36b2b"} strokeWidth="10" strokeLinecap="round" />
            <circle cx="176" cy="258" r="7" fill={negativeLead === "Ground clamp" ? "#7eb6c4" : "#f36b2b"} />
            <circle cx="426" cy="258" r="7" fill={positiveLead === "Ground clamp" ? "#7eb6c4" : "#f36b2b"} />
            <text x="176" y="282" fill="#d4d1c8" fontSize="13" textAnchor="middle">{negativeLead}</text>
            <text x="426" y="282" fill="#d4d1c8" fontSize="13" textAnchor="middle">{positiveLead}</text>
          </svg>
        </div>
        <div className="hookup-steps">
          <div><span className="socket-badge negative">−</span><p><strong>{negativeLead}</strong><small>Negative socket</small></p></div>
          <div><span className="socket-badge positive">+</span><p><strong>{positiveLead}</strong><small>Positive socket</small></p></div>
          <div><span className="socket-badge gas"><Wind size={16} /></span><p><strong>Shielding gas</strong><small>{data.gas}</small></p></div>
        </div>
      </div>
      <div className="polarity-footer">
        <span><strong>{data.polarity}</strong> · {data.polarityMeaning}</span>
        {data.caution ? <small>{data.caution}</small> : null}
      </div>
    </section>
  );
}
