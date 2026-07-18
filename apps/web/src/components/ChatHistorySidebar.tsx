import { Menu, MessageSquare, MessageSquarePlus, PanelLeftClose } from "lucide-react";

export type ConversationSummary = {
  conversationId: string;
  title: string;
  messageCount: number;
  updatedAt: number;
};

type ChatHistorySidebarProps = {
  activeConversationId: string;
  collapsed: boolean;
  conversations: ConversationSummary[] | undefined;
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (conversationId: string) => void;
};

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric"
});

function updatedLabel(timestamp: number): string {
  const updated = new Date(timestamp);
  const now = new Date();
  return updated.toDateString() === now.toDateString()
    ? timeFormatter.format(updated)
    : dateFormatter.format(updated);
}

export function ChatHistorySidebar({
  activeConversationId,
  collapsed,
  conversations,
  open,
  onClose,
  onNewChat,
  onSelect
}: ChatHistorySidebarProps) {
  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop${open ? " visible" : ""}`}
        aria-label="Close chat history"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`chat-sidebar${collapsed ? " collapsed" : ""}${open ? " open" : ""}`} aria-label="Chat history">
        <div className="sidebar-heading">
          <div className="sidebar-brand">
            <span><MessageSquare size={15} /></span>
            <strong>OmniPro 220</strong>
          </div>
          <button type="button" className="sidebar-close" aria-label="Hide chat history" onClick={onClose}>
            <PanelLeftClose size={17} />
          </button>
        </div>

        <button type="button" className="sidebar-new-chat" onClick={onNewChat}>
          <MessageSquarePlus size={16} />
          <span>New chat</span>
        </button>

        <div className="history-heading">
          <span>Recent chats</span>
          {conversations ? <small>{conversations.length}</small> : null}
        </div>

        <nav className="history-list" aria-label="Saved conversations">
          {conversations === undefined ? (
            <div className="history-status">Loading history…</div>
          ) : conversations.length === 0 ? (
            <div className="history-status">Your saved chats will appear here.</div>
          ) : conversations.map((conversation) => {
            const active = conversation.conversationId === activeConversationId;
            return (
              <button
                type="button"
                className={`history-item${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
                key={conversation.conversationId}
                onClick={() => onSelect(conversation.conversationId)}
              >
                <MessageSquare size={14} />
                <span>
                  <strong>{conversation.title}</strong>
                  <small>{updatedLabel(conversation.updatedAt)}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <Menu size={13} />
          <span>Chat history</span>
        </div>
      </aside>
    </>
  );
}
