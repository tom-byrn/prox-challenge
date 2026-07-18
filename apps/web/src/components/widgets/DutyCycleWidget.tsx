import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";

type Rating = {
  process: string;
  inputVoltage: number;
  amps: number;
  dutyPercent: number;
  weldMinutes: number;
  restMinutes: number;
  pages: number[];
};

type ExactDutyData = {
  exact: true;
  requested: { process: string; inputVoltage: number; amps: number };
  rating: Rating;
  periodMinutes: number;
};

type NearestDutyData = {
  exact: false;
  requested: { process: string; inputVoltage: number; amps: number };
  nearestPublishedRatings: Rating[];
  policy: string;
  periodMinutes: number;
};

function isExactDutyData(data: unknown): data is ExactDutyData {
  return Boolean(data && typeof data === "object" && (data as { exact?: unknown }).exact === true && (data as { rating?: unknown }).rating);
}

function isNearestDutyData(data: unknown): data is NearestDutyData {
  return Boolean(data && typeof data === "object" && (data as { exact?: unknown }).exact === false && Array.isArray((data as { nearestPublishedRatings?: unknown }).nearestPublishedRatings));
}

export function DutyCycleWidget({ data }: { data: unknown }) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const exactData = isExactDutyData(data) ? data : undefined;

  useEffect(() => {
    if (!playing || !exactData) return undefined;
    const interval = window.setInterval(() => {
      setElapsed((current) => current >= 100 ? 0 : current + 1);
    }, 100);
    return () => window.clearInterval(interval);
  }, [playing, exactData]);

  const currentMinute = useMemo(() => Math.min(10, elapsed / 10), [elapsed]);

  if (isNearestDutyData(data)) {
    return (
      <section className="widget duty-widget nearest-widget" aria-label="Nearest published duty cycle ratings">
        <div className="widget-heading">
          <div className="widget-icon warning"><TriangleAlert size={19} /></div>
          <div><span className="eyebrow">Unpublished operating point</span><h3>No certified rating at {data.requested.amps} A</h3></div>
        </div>
        <p>The manual does not give a duty cycle for this exact amperage, so Arcwell won’t estimate one.</p>
        <div className="nearest-ratings">
          {data.nearestPublishedRatings.map((rating) => (
            <div key={`${rating.inputVoltage}-${rating.amps}`}>
              <strong>{rating.amps} A</strong><span>{rating.dutyPercent}%</span><small>{rating.weldMinutes} min weld · {rating.restMinutes} min rest</small>
            </div>
          ))}
        </div>
        <div className="source-note"><ShieldCheck size={15} /> Published points only · Owner’s Manual, pp. {data.nearestPublishedRatings.flatMap((rating) => rating.pages).filter((page, index, all) => all.indexOf(page) === index).join(", ")}</div>
      </section>
    );
  }

  if (!exactData) return <section className="widget"><p>Duty-cycle data is unavailable.</p></section>;
  const { rating } = exactData;
  const isWelding = currentMinute < rating.weldMinutes;

  return (
    <section className="widget duty-widget" aria-label={`${rating.dutyPercent} percent duty cycle`}>
      <div className="widget-heading duty-heading">
        <div><span className="eyebrow">Certified 10-minute rating</span><h3>{rating.process} · {rating.inputVoltage} V · {rating.amps} A</h3></div>
        <strong className="duty-percent">{rating.dutyPercent}<small>%</small></strong>
      </div>
      <div className="duty-body">
        <div className="clock-wrap">
          <div className="duty-clock" style={{ "--duty-angle": `${rating.dutyPercent * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{currentMinute.toFixed(1)}</strong><span>min</span></div>
          </div>
          <div className={`cycle-state ${isWelding ? "weld" : "rest"}`}>{isWelding ? "Weld window" : "Rest window"}</div>
        </div>
        <div className="duty-details">
          <div className="duration-pair">
            <div><span className="duration-dot weld" /><strong>{rating.weldMinutes}</strong><span>minutes welding</span></div>
            <div><span className="duration-dot rest" /><strong>{rating.restMinutes}</strong><span>minutes resting</span></div>
          </div>
          <div className="cycle-track" aria-label={`${rating.weldMinutes} minutes welding then ${rating.restMinutes} minutes resting`}>
            <span className="weld-segment" style={{ width: `${rating.dutyPercent}%` }} />
            <span className="rest-segment" style={{ width: `${100 - rating.dutyPercent}%` }} />
            <i style={{ left: `${elapsed}%` }} />
          </div>
          <div className="clock-controls">
            <button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? "Pause" : "Play cycle"}</button>
            <button type="button" onClick={() => { setElapsed(0); setPlaying(false); }}><RotateCcw size={15} />Reset</button>
          </div>
        </div>
      </div>
      <div className="source-note"><ShieldCheck size={15} /> Owner’s Manual, pp. {rating.pages.join(", ")} · Leave power on while cooling so the fan can run.</div>
    </section>
  );
}
