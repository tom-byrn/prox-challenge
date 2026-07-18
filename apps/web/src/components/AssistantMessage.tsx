import { memo } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types";
import { ArtifactFrame } from "./ArtifactFrame";
import { SourceFigure } from "./SourceFigure";
import { WidgetRenderer } from "./WidgetRenderer";

type Props = {
  message: ChatMessage;
  onRepair: (message: string) => void;
};

export const AssistantMessage = memo(function AssistantMessage({ message, onRepair }: Props) {
  return (
    <article className="message assistant-message">
      <div className="assistant-mark" aria-hidden="true"><span /></div>
      <div className="assistant-content">
        <span className="speaker-label">Arcwell</span>
        {message.parts.map((part) => {
          if (part.type === "text") {
            return <div className="markdown" key={part.id}><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>;
          }
          if (part.type === "figure") return <SourceFigure key={part.id} figure={part.figure} />;
          if (part.type === "widget") return <WidgetRenderer key={part.id} widget={part.widget} />;
          return <ArtifactFrame key={part.id} artifact={part.artifact} onRepair={onRepair} />;
        })}
        {message.activeTools && message.activeTools.length > 0 ? (
          <div className="tool-activity"><LoaderCircle size={15} /> {message.activeTools.at(-1)?.label}</div>
        ) : null}
        {message.status === "streaming" && message.parts.length === 0 && (!message.activeTools || message.activeTools.length === 0) ? (
          <div className="thinking"><i /><i /><i /><span>Reading the source pack</span></div>
        ) : null}
        {message.error ? <div className="message-error"><TriangleAlert size={16} />{message.error}</div> : null}
      </div>
    </article>
  );
});
