import { memo } from "react";
import type { ChatMessage } from "../types";

export const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="message user-message">
      <span>You</span>
      <div className="user-message-bubble">
        {message.parts.map((part) => {
          if (part.type === "photo") {
            return <img key={part.id} className="user-photo" src={part.photo.url} alt={part.photo.alt} width={part.photo.width} height={part.photo.height} loading="lazy" decoding="async" />;
          }
          if (part.type === "text") return <p key={part.id}>{part.text}</p>;
          return null;
        })}
      </div>
    </article>
  );
});
