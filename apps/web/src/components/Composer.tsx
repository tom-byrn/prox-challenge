import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
};

export function Composer({ value, onChange, onSubmit, onStop, busy }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder="Ask about the OmniPro 220…"
          aria-label="Message the OmniPro 220 assistant"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!busy && value.trim()) onSubmit();
            }
          }}
        />
        <button className={busy ? "stop-button" : "send-button"} type="button" onClick={busy ? onStop : onSubmit} disabled={!busy && !value.trim()} aria-label={busy ? "Stop response" : "Send message"}>
          {busy ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
        </button>
      </div>
    </div>
  );
}
