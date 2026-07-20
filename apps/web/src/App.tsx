import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelLeftOpen, Settings2 } from "lucide-react";
import { AssistantMessage } from "./components/AssistantMessage";
import { ChatHistorySidebar } from "./components/ChatHistorySidebar";
import { Composer } from "./components/Composer";
import { UserMessage } from "./components/UserMessage";
import { useChatPersistence } from "./lib/chat-persistence";
import { uploadPhoto, validatePhotoFile, type PhotoDraft } from "./lib/photos";
import { streamChat } from "./lib/stream-chat";
import type { EvidenceSource } from "./evidence";
import type { ChatMessage, ChatPart, StreamEvent, ToolCall, TurnMetrics } from "./types";
import type { ProcedureSpec } from "./visual-spec";

const SAMPLE_QUESTIONS = [
  "What’s the duty cycle for MIG welding at 200A on 240V?",
  "I’m getting porosity in my flux-cored welds. What should I check?",
  "What polarity setup do I need for TIG? Which socket gets the ground clamp?"
] as const;

const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

function newConversationId() {
  return crypto.randomUUID();
}

type ConversationRoute = {
  conversationId: string;
  loadStored: boolean;
};

function conversationRouteFromLocation(): ConversationRoute {
  const storedId = new URL(window.location.href).searchParams.get("chat")?.trim();
  return storedId && storedId.length <= 100
    ? { conversationId: storedId, loadStored: true }
    : { conversationId: newConversationId(), loadStored: false };
}

function updateConversationUrl(conversationId?: string, mode: "push" | "replace" = "replace") {
  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set("chat", conversationId);
  else url.searchParams.delete("chat");
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}

function conversationTitle(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77).trimEnd()}…` : text;
}

function appendTextPart(parts: ChatPart[], text: string): ChatPart[] {
  const last = parts.at(-1);
  if (last?.type === "text") {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { id: crypto.randomUUID(), type: "text", text }];
}

function finishRunningTools(toolCalls: ToolCall[] | undefined, status: ToolCall["status"]): ToolCall[] {
  return (toolCalls ?? []).map((tool) => tool.status === "running" ? { ...tool, status } : tool);
}

function mergeSources(current: EvidenceSource[] | undefined, incoming: EvidenceSource[]): EvidenceSource[] {
  const sources = new Map((current ?? []).map((source) => [source.id, source]));
  for (const source of incoming) sources.set(source.id, source);
  return [...sources.values()].slice(0, 16);
}

function finalizeMetrics(message: ChatMessage, event: Extract<StreamEvent, { type: "done" }>): TurnMetrics {
  const toolCalls = message.toolCalls ?? [];
  const baseline: TurnMetrics = event.metrics ?? {
    status: message.error ? "error" : "success",
    model: "unknown",
    costUsd: event.costUsd ?? 0,
    durationMs: Date.now() - (message.startedAt ?? Date.now()),
    apiDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    sdkTurns: 0,
    toolCalls: 0,
    toolErrors: 0,
    repaired: false,
    validationIssues: 0
  };
  return {
    ...baseline,
    status: message.error ? "error" : baseline.status,
    toolCalls: Math.max(baseline.toolCalls, toolCalls.length),
    toolErrors: Math.max(baseline.toolErrors, toolCalls.filter((tool) => tool.status === "error").length)
  };
}

export default function App() {
  const [initialRoute] = useState(conversationRouteFromLocation);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>();
  const [photoError, setPhotoError] = useState<string>();
  const [photoUploadsAvailable, setPhotoUploadsAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(initialRoute.loadStored);
  const [sessionId, setSessionId] = useState<string>();
  const [conversationRoute, setConversationRoute] = useState(initialRoute);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string>();
  const { conversations, loadConversation, ownerId, persistenceAvailable, recordTelemetry, removeConversation, saveMessage: saveStoredMessage, storageError } = useChatPersistence();
  const conversationId = conversationRoute.conversationId;
  const abortRef = useRef<AbortController | undefined>(undefined);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const followStreamRef = useRef(true);
  const messageSnapshotsRef = useRef(new Map<string, ChatMessage>());
  const messageSequencesRef = useRef(new Map<string, number>());
  const nextSequenceRef = useRef(0);
  const titleRef = useRef("");
  const photoDraftRef = useRef<PhotoDraft | undefined>(undefined);

  const clearPhoto = useCallback(() => {
    setPhotoDraft((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return undefined;
    });
    setPhotoError(undefined);
  }, []);

  const selectPhoto = useCallback((file: File) => {
    const error = validatePhotoFile(file);
    if (error) {
      setPhotoError(error);
      return;
    }
    setPhotoDraft((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
    setPhotoError(undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : undefined)
      .then((health: { photoStorage?: "local" | "disabled" } | undefined) => {
        if (health?.photoStorage === "disabled") {
          setPhotoUploadsAvailable(false);
          clearPhoto();
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [clearPhoto]);

  useEffect(() => {
    photoDraftRef.current = photoDraft;
  }, [photoDraft]);

  useEffect(() => () => {
    const current = photoDraftRef.current;
    if (current) URL.revokeObjectURL(current.previewUrl);
  }, []);

  useEffect(() => {
    if (!conversationRoute.loadStored) {
      setHydrating(false);
      return;
    }

    let cancelled = false;
    setHydrating(true);
    void loadConversation(conversationId)
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          setMessages([]);
          setSessionId(undefined);
          messageSnapshotsRef.current.clear();
          messageSequencesRef.current.clear();
          nextSequenceRef.current = 0;
          titleRef.current = "";
          return;
        }

        const ordered = [...stored.messages].sort((a, b) => a.sequence - b.sequence);
        const restoredMessages = ordered.map((message) => message.payload);
        setMessages(restoredMessages);
        setSessionId(stored.sessionId);
        messageSnapshotsRef.current = new Map(restoredMessages.map((message) => [message.id, message]));
        messageSequencesRef.current = new Map(ordered.map((message) => [message.payload.id, message.sequence]));
        nextSequenceRef.current = ordered.reduce((next, message) => Math.max(next, message.sequence + 1), 0);
        titleRef.current = stored.title;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, conversationRoute.loadStored, loadConversation]);

  useEffect(() => {
    const handlePopState = () => {
      abortRef.current?.abort();
      abortRef.current = undefined;
      messageSnapshotsRef.current.clear();
      messageSequencesRef.current.clear();
      nextSequenceRef.current = 0;
      titleRef.current = "";
      setMessages([]);
      setInput("");
      clearPhoto();
      setSessionId(undefined);
      setBusy(false);
      setConversationRoute(conversationRouteFromLocation());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearPhoto]);

  useEffect(() => {
    const updateFollowState = () => {
      const distanceFromBottom = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      followStreamRef.current = distanceFromBottom < 120;
    };

    window.addEventListener("scroll", updateFollowState, { passive: true });
    return () => window.removeEventListener("scroll", updateFollowState);
  }, []);

  useLayoutEffect(() => {
    if (busy && followStreamRef.current) scrollAnchorRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const updateAssistant = useCallback((assistantId: string, updater: (message: ChatMessage) => ChatMessage): ChatMessage | undefined => {
    const current = messageSnapshotsRef.current.get(assistantId);
    if (!current) return undefined;
    const updated = updater(current);
    messageSnapshotsRef.current.set(assistantId, updated);
    setMessages((messages) => messages.map((message) => message.id === assistantId ? updated : message));
    return updated;
  }, []);

  const persistMessage = useCallback((message: ChatMessage, storedSessionId?: string) => {
    const sequence = messageSequencesRef.current.get(message.id);
    if (sequence === undefined) return;
    void saveStoredMessage({
      conversationId,
      title: titleRef.current || "New chat",
      sessionId: storedSessionId,
      sequence,
      message
    });
  }, [conversationId, saveStoredMessage]);

  const handleEvent = useCallback((assistantId: string, event: StreamEvent) => {
    if (event.type === "text_delta" || event.type === "clarification") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: appendTextPart(message.parts, event.text) }));
      return;
    }
    if (event.type === "tool_start") {
      updateAssistant(assistantId, (message) => ({
        ...message,
        toolCalls: [...(message.toolCalls ?? []), { id: event.id, name: event.name, label: event.label, input: event.input, status: "running" }]
      }));
      return;
    }
    if (event.type === "tool_end") {
      updateAssistant(assistantId, (message) => ({
        ...message,
        toolCalls: (message.toolCalls ?? []).map((tool) => tool.id === event.id ? { ...tool, status: event.ok ? "complete" : "error" } : tool)
      }));
      return;
    }
    if (event.type === "clarification_request") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "clarification", clarification: event.clarification }] }));
      return;
    }
    if (event.type === "evidence") {
      updateAssistant(assistantId, (message) => ({ ...message, sources: mergeSources(message.sources, event.sources) }));
      return;
    }
    if (event.type === "figure") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "figure", figure: event.figure }] }));
      return;
    }
    if (event.type === "video") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "video", video: event.video }] }));
      return;
    }
    if (event.type === "widget") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "widget", widget: event.widget }] }));
      return;
    }
    if (event.type === "visual") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "visual", visual: event.visual }] }));
      return;
    }
    if (event.type === "artifact") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "artifact", artifact: event.artifact }] }));
      return;
    }
    if (event.type === "error") {
      updateAssistant(assistantId, (message) => ({ ...message, status: "error", error: event.message, toolCalls: finishRunningTools(message.toolCalls, "error") }));
      return;
    }
    if (event.type === "done") {
      const storedSessionId = event.sessionId ?? sessionId;
      if (event.sessionId) setSessionId(event.sessionId);
      const updated = updateAssistant(assistantId, (message) => ({
        ...message,
        status: message.error ? "error" : "done",
        toolCalls: finishRunningTools(message.toolCalls, message.error ? "error" : "complete"),
        metrics: finalizeMetrics(message, event)
      }));
      if (updated) {
        persistMessage(updated, storedSessionId);
        if (updated.metrics) {
          void recordTelemetry({
            conversationId,
            messageId: updated.id,
            conversationTitle: titleRef.current || "New chat",
            metrics: updated.metrics
          });
        }
      }
    }
  }, [conversationId, persistMessage, recordTelemetry, sessionId, updateAssistant]);

  const sendMessage = useCallback(async (override?: string, displayOverride?: string) => {
    const attachedDraft = override === undefined ? photoDraft : undefined;
    const text = (override ?? input).trim() || (attachedDraft ? "Inspect this photo and tell me what I should check." : "");
    if (!text || busy || abortRef.current) return;
    const displayText = displayOverride?.trim() || (override === undefined && !input.trim() && attachedDraft ? "What should I check in this photo?" : text);
    setPhotoError(undefined);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let photo;
    if (attachedDraft) {
      try {
        photo = await uploadPhoto(attachedDraft.file, controller.signal);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPhotoError(error instanceof Error ? error.message : "The photo upload failed.");
        setBusy(false);
        abortRef.current = undefined;
        return;
      }
    }

    const userParts: ChatPart[] = [];
    if (photo) userParts.push({ id: crypto.randomUUID(), type: "photo", photo });
    userParts.push({ id: crypto.randomUUID(), type: "text", text: displayText });
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", parts: userParts, status: "done" };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", parts: [], status: "streaming", toolCalls: [], startedAt: Date.now() };
    const userSequence = nextSequenceRef.current++;
    const assistantSequence = nextSequenceRef.current++;
    messageSnapshotsRef.current.set(userMessage.id, userMessage);
    messageSnapshotsRef.current.set(assistantMessage.id, assistantMessage);
    messageSequencesRef.current.set(userMessage.id, userSequence);
    messageSequencesRef.current.set(assistantMessage.id, assistantSequence);
    if (!titleRef.current) titleRef.current = conversationTitle(displayText);
    if (persistenceAvailable !== false) updateConversationUrl(conversationId);
    persistMessage(userMessage, sessionId);
    followStreamRef.current = true;
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput("");
    if (attachedDraft) clearPhoto();

    try {
      const conversationContext = messages
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: message.parts
            .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("")
            .trim()
            .slice(-8_000)
        }))
        .filter((message) => message.content.length > 0);
      await streamChat({
        message: text,
        sessionId,
        conversationContext,
        conversationId,
        photoId: photo?.id,
        signal: controller.signal,
        onEvent: (event) => handleEvent(assistantId, event)
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const updated = updateAssistant(assistantId, (message) => ({
          ...message,
          status: "error",
          toolCalls: finishRunningTools(message.toolCalls, "error"),
          error: error instanceof Error ? error.message : "The response failed."
        }));
        if (updated) persistMessage(updated, sessionId);
      } else {
        const updated = updateAssistant(assistantId, (message) => ({ ...message, status: "done", toolCalls: finishRunningTools(message.toolCalls, "error") }));
        if (updated) persistMessage(updated, sessionId);
      }
    } finally {
      setBusy(false);
      abortRef.current = undefined;
    }
  }, [busy, clearPhoto, conversationId, handleEvent, input, messages, persistMessage, persistenceAvailable, photoDraft, sessionId, updateAssistant]);

  const handleClarification = useCallback((answer: string, originalQuestion: string) => {
    const continuation = `The user is answering a clarification request. Continue the original task using this context:\n${JSON.stringify({ originalQuestion, answer })}`;
    void sendMessage(continuation, answer);
  }, [sendMessage]);

  const handleRepair = useCallback((message: string) => {
    void sendMessage(message);
  }, [sendMessage]);

  const handleStepHelp = useCallback((stepNumber: number, step: ProcedureSpec["steps"][number]) => {
    const continuation = `The user wants help with one specific step from the current procedure. Explain how to carry out this exact step, what to look for, and what to do based on the result. Keep the answer tied to the existing conversation and source evidence:\n${JSON.stringify({ stepNumber, title: step.title, instruction: step.body, evidence: step.evidence })}`;
    void sendMessage(continuation, `Help me with step ${stepNumber}: ${step.title}`);
  }, [sendMessage]);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    messageSnapshotsRef.current.clear();
    messageSequencesRef.current.clear();
    nextSequenceRef.current = 0;
    titleRef.current = "";
    setMessages([]);
    setInput("");
    clearPhoto();
    setSessionId(undefined);
    setConversationRoute({ conversationId: newConversationId(), loadStored: false });
    setBusy(false);
    setSidebarOpen(false);
    updateConversationUrl(undefined, "push");
  }, [clearPhoto]);

  const selectConversation = useCallback((selectedConversationId: string) => {
    setSidebarOpen(false);
    if (selectedConversationId === conversationId && conversationRoute.loadStored) return;
    abortRef.current?.abort();
    abortRef.current = undefined;
    messageSnapshotsRef.current.clear();
    messageSequencesRef.current.clear();
    nextSequenceRef.current = 0;
    titleRef.current = "";
    setMessages([]);
    setInput("");
    clearPhoto();
    setSessionId(undefined);
    setBusy(false);
    setConversationRoute({ conversationId: selectedConversationId, loadStored: true });
    updateConversationUrl(selectedConversationId, "push");
  }, [clearPhoto, conversationId, conversationRoute.loadStored]);

  const deleteConversation = useCallback(async (selectedConversationId: string) => {
    if (deletingConversationId || (busy && selectedConversationId === conversationId)) return;
    setDeletingConversationId(selectedConversationId);
    const removed = await removeConversation(selectedConversationId);
    setDeletingConversationId(undefined);
    if (removed && selectedConversationId === conversationId) resetChat();
  }, [busy, conversationId, deletingConversationId, removeConversation, resetChat]);

  const hideSidebar = useCallback(() => {
    setSidebarOpen(false);
    if (!window.matchMedia("(max-width: 850px)").matches) setSidebarCollapsed(true);
  }, []);

  const showSidebar = useCallback(() => {
    setSidebarCollapsed(false);
    setSidebarOpen(true);
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const submitMessage = useCallback(() => { void sendMessage(); }, [sendMessage]);
  const stopResponse = useCallback(() => abortRef.current?.abort(), []);

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${sidebarOpen ? " sidebar-open" : ""}`}>
      <ChatHistorySidebar
        activeConversationId={conversationId}
        collapsed={sidebarCollapsed}
        conversations={conversations}
        deletingConversationId={deletingConversationId}
        deleteDisabledConversationId={busy ? conversationId : undefined}
        open={sidebarOpen}
        persistenceAvailable={persistenceAvailable}
        onClose={hideSidebar}
        onDelete={deleteConversation}
        onNewChat={resetChat}
        onSelect={selectConversation}
      />
      <button type="button" className="settings-launcher" aria-label="Open settings and telemetry" onClick={openSettings}>
        <Settings2 size={15} />
        <span>Settings</span>
      </button>
      {settingsOpen ? <Suspense fallback={null}><SettingsPanel ownerId={ownerId} onClose={closeSettings} /></Suspense> : null}
      <header className="topbar">
        <div className="header-inner">
          <button
            type="button"
            className="sidebar-menu-button"
            aria-label="Show chat history"
            aria-expanded={sidebarOpen}
            onClick={showSidebar}
          >
            <PanelLeftOpen size={18} />
          </button>
          <strong>OmniPro 220 Assistant</strong>
        </div>
      </header>

      <main className="chat-main">
        {persistenceAvailable === false ? (
          <div className="storage-warning" role="status">Saved chats are disabled here. This conversation will be lost when you refresh.</div>
        ) : storageError ? (
          <div className="storage-warning" role="status">Chat storage is temporarily unavailable. This conversation may not be saved.</div>
        ) : null}
        {hydrating ? (
          <section className="empty-state"><p>Loading saved conversation…</p></section>
        ) : messages.length === 0 ? (
          <section className="empty-state">
            <h1>OmniPro 220 Assistant</h1>
            <p>Ask about setup, operation, or troubleshooting.</p>
            {!input.trim() && !photoDraft ? (
              <div className="sample-questions" aria-label="Example questions">
                {SAMPLE_QUESTIONS.map((question) => (
                  <button type="button" key={question} onClick={() => void sendMessage(question)}>{question}</button>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="conversation" aria-live="polite">
            {messages.map((message) => message.role === "user"
              ? <UserMessage key={message.id} message={message} />
              : <AssistantMessage key={message.id} message={message} onRepair={handleRepair} onClarify={handleClarification} onStepHelp={handleStepHelp} stepHelpDisabled={busy} />)}
            <div ref={scrollAnchorRef} />
          </section>
        )}
        {!hydrating ? (
          <Composer
            value={input}
            photo={photoDraft}
            photoError={photoError}
            photoUploadsAvailable={photoUploadsAvailable}
            onChange={setInput}
            onPhotoSelect={selectPhoto}
            onPhotoRemove={clearPhoto}
            onSubmit={submitMessage}
            onStop={stopResponse}
            busy={busy}
          />
        ) : null}
      </main>
    </div>
  );
}
