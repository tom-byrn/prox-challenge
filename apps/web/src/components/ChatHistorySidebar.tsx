import { LoaderCircle, MessageSquare, MessageSquarePlus, PanelLeftClose, Trash2 } from "lucide-react";

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
  deletingConversationId?: string;
  deleteDisabledConversationId?: string;
  open: boolean;
  onClose: () => void;
  onDelete: (conversationId: string) => void;
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
  deletingConversationId,
  deleteDisabledConversationId,
  open,
  onClose,
  onDelete,
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
            const deleting = deletingConversationId === conversation.conversationId;
            const deleteDisabled = deleting || deleteDisabledConversationId === conversation.conversationId;
            return (
              <div className={`history-item${active ? " active" : ""}`} key={conversation.conversationId}>
                <button
                  type="button"
                  className="history-item-main"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSelect(conversation.conversationId)}
                >
                  <MessageSquare size={14} />
                  <span>
                    <strong>{conversation.title}</strong>
                    <small>{updatedLabel(conversation.updatedAt)}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label={`Delete ${conversation.title}`}
                  title={deleteDisabledConversationId === conversation.conversationId ? "Stop the response before deleting this chat" : `Delete ${conversation.title}`}
                  disabled={deleteDisabled}
                  onClick={() => onDelete(conversation.conversationId)}
                >
                  {deleting ? <LoaderCircle className="spinning" size={13} /> : <Trash2 size={13} />}
                </button>
              </div>
            );
          })}
        </nav>

      </aside>
    </>
  );
}
