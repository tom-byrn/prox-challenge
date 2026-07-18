import { memo } from "react";
import { TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types";
import { ArtifactFrame } from "./ArtifactFrame";
import { ClarificationCard } from "./ClarificationCard";
import { SourceFigure } from "./SourceFigure";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { WidgetRenderer } from "./WidgetRenderer";
import { VisualRenderer } from "./visuals/VisualRenderer";

type Props = {
  message: ChatMessage;
  onRepair: (message: string) => void;
  onClarify: (answer: string, originalQuestion: string) => void;
};

export const AssistantMessage = memo(function AssistantMessage({ message, onRepair, onClarify }: Props) {
  return (
    <article className="message assistant-message">
      <div className="assistant-content">
        <span className="speaker-label">Assistant</span>
        {message.toolCalls && message.toolCalls.length > 0 ? <ToolCallTimeline toolCalls={message.toolCalls} complete={message.status !== "streaming"} /> : null}
        {message.parts.map((part) => {
          if (part.type === "text") {
            return <div className="markdown" key={part.id}><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>;
          }
          if (part.type === "figure") return <SourceFigure key={part.id} figure={part.figure} />;
          if (part.type === "widget") return <WidgetRenderer key={part.id} widget={part.widget} />;
          if (part.type === "visual") return <VisualRenderer key={part.id} visual={part.visual} />;
          if (part.type === "clarification") return <ClarificationCard key={part.id} clarification={part.clarification} disabled={message.status === "streaming"} onRespond={onClarify} />;
          return <ArtifactFrame key={part.id} artifact={part.artifact} onRepair={onRepair} />;
        })}
        {message.status === "streaming" && message.parts.length === 0 && (!message.toolCalls || message.toolCalls.length === 0) ? (
          <div className="thinking"><i /><i /><i /><span>Thinking</span></div>
        ) : null}
        {message.error ? <div className="message-error"><TriangleAlert size={16} />{message.error}</div> : null}
      </div>
    </article>
  );
});
