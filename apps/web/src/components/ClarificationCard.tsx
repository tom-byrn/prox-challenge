import { memo, useState, type FormEvent } from "react";
import { ArrowRight, CircleHelp } from "lucide-react";
import type { ClarificationRequest } from "../types";

type Props = {
  clarification: ClarificationRequest;
  disabled: boolean;
  onRespond: (answer: string, originalQuestion: string) => void;
};

export const ClarificationCard = memo(function ClarificationCard({ clarification, disabled, onRespond }: Props) {
  const [other, setOther] = useState("");
  const [submitted, setSubmitted] = useState<string>();
  const locked = disabled || submitted !== undefined;

  const respond = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed || locked) return;
    setSubmitted(trimmed);
    onRespond(trimmed, clarification.originalQuestion);
  };

  const submitOther = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    respond(other);
  };

  return (
    <section className="clarification-card" aria-labelledby={`clarification-${clarification.id}`}>
      <header>
        <span><CircleHelp size={17} /></span>
        <div>
          <small>One detail needed</small>
          <h3 id={`clarification-${clarification.id}`}>{clarification.question}</h3>
        </div>
      </header>
      <div className="clarification-options">
        {clarification.options.map((option) => (
          <button
            type="button"
            key={option.id}
            disabled={locked}
            aria-pressed={submitted === option.label}
            onClick={() => respond(option.label)}
          >
            <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      {clarification.allowOther ? (
        <form onSubmit={submitOther}>
          <label htmlFor={`clarification-other-${clarification.id}`}>Something else</label>
          <div>
            <input
              id={`clarification-other-${clarification.id}`}
              value={other}
              disabled={locked}
              maxLength={500}
              placeholder="Explain your setup or what you meant"
              onChange={(event) => setOther(event.target.value)}
            />
            <button type="submit" disabled={locked || !other.trim()} aria-label="Send explanation"><ArrowRight size={15} /></button>
          </div>
        </form>
      ) : null}
      {submitted ? <p className="clarification-submitted">Continuing with: <strong>{submitted}</strong></p> : null}
    </section>
  );
});
