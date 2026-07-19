import { memo } from "react";
import { TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../types";
import { ArtifactFrame } from "./ArtifactFrame";
import { ClarificationCard } from "./ClarificationCard";
import { SourceFigure } from "./SourceFigure";
import { SourcesDrawer } from "./SourcesDrawer";
import { ToolCallTimeline } from "./ToolCallTimeline";
import { VideoSourceCard } from "./VideoSourceCard";
import { WidgetRenderer } from "./WidgetRenderer";
import { VisualRenderer } from "./visuals/VisualRenderer";

type Props = {
  message: ChatMessage;
  onRepair: (message: string) => void;
  onClarify: (answer: string, originalQuestion: string) => void;
  onStepHelp: (stepNumber: number) => void;
  stepHelpDisabled: boolean;
};

export const AssistantMessage = memo(function AssistantMessage({ message, onRepair, onClarify, onStepHelp, stepHelpDisabled }: Props) {
  const walkthroughParts: ChatMessage["parts"] = [];
  const regularParts: ChatMessage["parts"] = [];
  for (const part of message.parts) {
    const isWalkthrough = (part.type === "visual" && part.visual.spec.kind === "procedure")
      || (part.type === "widget" && part.widget.name === "troubleshooting");
    if (isWalkthrough) walkthroughParts.push(part);
    else regularParts.push(part);
  }

  function renderPart(part: ChatMessage["parts"][number]) {
    if (part.type === "text") {
      return <div className="markdown" key={part.id}><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>;
    }
    if (part.type === "figure") return <SourceFigure key={part.id} figure={part.figure} />;
    if (part.type === "video") return <VideoSourceCard key={part.id} video={part.video} />;
    if (part.type === "photo") return <img key={part.id} className="user-photo" src={part.photo.url} alt={part.photo.alt} width={part.photo.width} height={part.photo.height} loading="lazy" decoding="async" />;
    if (part.type === "widget") return <WidgetRenderer key={part.id} widget={part.widget} onStepHelp={onStepHelp} stepHelpDisabled={stepHelpDisabled} />;
    if (part.type === "visual") return <VisualRenderer key={part.id} visual={part.visual} onStepHelp={onStepHelp} stepHelpDisabled={stepHelpDisabled} />;
    if (part.type === "clarification") return <ClarificationCard key={part.id} clarification={part.clarification} disabled={message.status === "streaming"} onRespond={onClarify} />;
    return <ArtifactFrame key={part.id} artifact={part.artifact} onRepair={onRepair} />;
  }

  return (
    <article className="message assistant-message">
      <div className="assistant-content">
        <span className="speaker-label">Assistant</span>
        {message.toolCalls && message.toolCalls.length > 0 ? <ToolCallTimeline toolCalls={message.toolCalls} complete={message.status !== "streaming"} /> : null}
        {regularParts.map(renderPart)}
        {message.status !== "streaming" ? walkthroughParts.map(renderPart) : null}
        {message.sources?.length ? <SourcesDrawer sources={message.sources} /> : null}
        {message.status === "streaming" && message.parts.length === 0 && (!message.toolCalls || message.toolCalls.length === 0) ? (
          <div className="thinking"><i /><i /><i /><span>Thinking</span></div>
        ) : null}
        {message.error ? <div className="message-error"><TriangleAlert size={16} />{message.error}</div> : null}
      </div>
    </article>
  );
});
