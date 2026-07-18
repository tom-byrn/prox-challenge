import { memo, useEffect, useState, type SyntheticEvent } from "react";
import { Check, ChevronDown, CircleX, LoaderCircle } from "lucide-react";
import type { ToolCall } from "../types";

type Props = {
  toolCalls: ToolCall[];
  complete: boolean;
};

const TOOL_STATUS_LABELS: Record<ToolCall["status"], string> = {
  running: "Running",
  complete: "Complete",
  error: "Failed"
};

function formatInput(input: ToolCall["input"]): string {
  if (Object.keys(input).length === 0) return "No input";
  return JSON.stringify(input, null, 2);
}

export const ToolCallTimeline = memo(function ToolCallTimeline({ toolCalls, complete }: Props) {
  const runningCount = toolCalls.filter((tool) => tool.status === "running").length;
  const hasErrors = toolCalls.some((tool) => tool.status === "error");
  const [open, setOpen] = useState(!complete);

  useEffect(() => {
    setOpen(!complete);
  }, [complete]);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  };

  return (
    <details className={`tool-timeline${runningCount > 0 ? " is-running" : ""}${hasErrors ? " has-errors" : ""}`} open={open} onToggle={handleToggle}>
      <summary className="tool-timeline-overview">
        <span className="tool-timeline-overview-marker" aria-hidden="true">
          {runningCount > 0 ? <LoaderCircle size={13} /> : hasErrors ? <CircleX size={13} /> : <Check size={13} />}
        </span>
        <span className="tool-timeline-overview-name">
          <strong>{runningCount > 0 ? "Using tools" : "Tools used"}</strong>
          <small>{toolCalls.length} {toolCalls.length === 1 ? "call" : "calls"}</small>
        </span>
        <span className="tool-timeline-overview-state">{runningCount > 0 ? "Working" : hasErrors ? "Failed" : "Complete"}</span>
        <ChevronDown className="tool-timeline-overview-chevron" size={14} aria-hidden="true" />
      </summary>
      <ol className="tool-timeline-list">
        {toolCalls.map((tool) => (
          <li className={`tool-timeline-item ${tool.status}`} key={tool.id}>
            <details>
              <summary>
                <span className="tool-timeline-marker" aria-hidden="true">
                  {tool.status === "running" ? <LoaderCircle size={12} /> : tool.status === "complete" ? <Check size={12} /> : <CircleX size={12} />}
                </span>
                <span className="tool-timeline-name">
                  <strong>{tool.label}</strong>
                  <code>{tool.name}</code>
                </span>
                <span className="tool-timeline-state">{TOOL_STATUS_LABELS[tool.status]}</span>
                <ChevronDown className="tool-timeline-chevron" size={13} aria-hidden="true" />
              </summary>
              <div className="tool-input">
                <span>Input</span>
                <pre>{formatInput(tool.input)}</pre>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
});
