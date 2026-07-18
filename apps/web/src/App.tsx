import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cable, ChevronRight, Flame, Gauge, LifeBuoy, Menu, MessageSquarePlus, PanelLeftClose, SearchCheck, ShieldCheck, Sparkles, X } from "lucide-react";
import { AssistantMessage } from "./components/AssistantMessage";
import { Composer } from "./components/Composer";
import { streamChat } from "./lib/stream-chat";
import type { ChatMessage, ChatPart, StreamEvent } from "./types";

const SUGGESTIONS = [
  {
    icon: Gauge,
    label: "Duty cycle",
    question: "What’s the duty cycle for MIG welding at 200A on 240V?",
    hint: "Rated output + live cycle"
  },
  {
    icon: LifeBuoy,
    label: "Diagnose a weld",
    question: "I’m getting porosity in my flux-cored welds. What should I check?",
    hint: "Checklist + manual figure"
  },
  {
    icon: Cable,
    label: "Cable setup",
    question: "What polarity setup do I need for TIG? Which socket gets the ground clamp?",
    hint: "Visual cable routing"
  }
] as const;

const SOURCE_STATS = [
  ["51", "source pages"],
  ["19", "curated figures"],
  ["6", "verified datasets"]
] as const;

function newConversationId() {
  return crypto.randomUUID();
}

function appendTextPart(parts: ChatPart[], text: string): ChatPart[] {
  const last = parts.at(-1);
  if (last?.type === "text") {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { id: crypto.randomUUID(), type: "text", text }];
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string>();
  const [conversationId, setConversationId] = useState(newConversationId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (busy) scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const updateAssistant = useCallback((assistantId: string, updater: (message: ChatMessage) => ChatMessage) => {
    setMessages((current) => current.map((message) => message.id === assistantId ? updater(message) : message));
  }, []);

  const handleEvent = useCallback((assistantId: string, event: StreamEvent) => {
    if (event.type === "text_delta") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: appendTextPart(message.parts, event.text) }));
      return;
    }
    if (event.type === "tool_start") {
      updateAssistant(assistantId, (message) => ({ ...message, activeTools: [...(message.activeTools ?? []), { id: event.id, label: event.label }] }));
      return;
    }
    if (event.type === "tool_end") {
      updateAssistant(assistantId, (message) => ({ ...message, activeTools: (message.activeTools ?? []).filter((tool) => tool.id !== event.id) }));
      return;
    }
    if (event.type === "figure") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "figure", figure: event.figure }] }));
      return;
    }
    if (event.type === "widget") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "widget", widget: event.widget }] }));
      return;
    }
    if (event.type === "artifact") {
      updateAssistant(assistantId, (message) => ({ ...message, parts: [...message.parts, { id: crypto.randomUUID(), type: "artifact", artifact: event.artifact }] }));
      return;
    }
    if (event.type === "error") {
      updateAssistant(assistantId, (message) => ({ ...message, status: "error", error: event.message, activeTools: [] }));
      return;
    }
    if (event.type === "done") {
      if (event.sessionId) setSessionId(event.sessionId);
      updateAssistant(assistantId, (message) => ({ ...message, status: message.error ? "error" : "done", activeTools: [] }));
    }
  }, [updateAssistant]);

  const sendMessage = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", parts: [{ id: crypto.randomUUID(), type: "text", text }], status: "done" };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", parts: [], status: "streaming", activeTools: [] };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput("");
    setBusy(true);
    setSidebarOpen(false);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        message: text,
        sessionId,
        conversationId,
        signal: controller.signal,
        onEvent: (event) => handleEvent(assistantId, event)
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        updateAssistant(assistantId, (message) => ({ ...message, status: "error", activeTools: [], error: error instanceof Error ? error.message : "The response failed." }));
      } else {
        updateAssistant(assistantId, (message) => ({ ...message, status: "done", activeTools: [] }));
      }
    } finally {
      setBusy(false);
      abortRef.current = undefined;
    }
  }, [busy, conversationId, handleEvent, input, sessionId, updateAssistant]);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setSessionId(undefined);
    setConversationId(newConversationId());
    setBusy(false);
    setSidebarOpen(false);
  }, []);

  const firstUserQuestion = useMemo(() => messages.find((message) => message.role === "user")?.parts[0]?.type === "text" ? (messages.find((message) => message.role === "user")?.parts[0] as { text: string }).text : undefined, [messages]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open source panel"><Menu size={20} /></button>
        <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); resetChat(); }}>
          <span className="brand-mark"><Flame size={20} fill="currentColor" /></span>
          <span><strong>Arcwell</strong><small>OMNIPRO 220 FIELD GUIDE</small></span>
        </a>
        <div className="header-context">
          {firstUserQuestion ? <span>{firstUserQuestion}</span> : <span>Manual-grounded welding support</span>}
        </div>
        <div className="header-actions">
          <span className="source-status"><i /> Sources ready</span>
          <button type="button" onClick={resetChat}><MessageSquarePlus size={17} /><span>New chat</span></button>
        </div>
      </header>

      <div className="body-layout">
        <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
          <button className="sidebar-close" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close source panel"><X size={19} /></button>
          <div className="machine-card">
            <div className="machine-image"><img src="/product.webp" alt="Vulcan OmniPro 220 welder" /></div>
            <span className="eyebrow">Your machine</span>
            <h2>Vulcan OmniPro 220</h2>
            <p>Multiprocess · 120/240 V · Item 57812</p>
            <div className="process-tags"><span>MIG</span><span>Flux</span><span>TIG</span><span>Stick</span></div>
          </div>

          <div className="source-pack">
            <div className="sidebar-section-title"><span>Source pack</span><SearchCheck size={16} /></div>
            {SOURCE_STATS.map(([value, label]) => <div className="source-stat" key={label}><strong>{value}</strong><span>{label}</span><ShieldCheck size={14} /></div>)}
            <p>Extracted once, committed, and checked against the page pixels.</p>
          </div>

          <div className="sidebar-prompts">
            <span className="sidebar-section-title">Quick asks</span>
            {SUGGESTIONS.map((suggestion) => (
              <button type="button" key={suggestion.label} onClick={() => void sendMessage(suggestion.question)} disabled={busy}>
                <suggestion.icon size={16} /><span>{suggestion.label}</span><ChevronRight size={15} />
              </button>
            ))}
          </div>

          <div className="safety-note"><ShieldCheck size={17} /><p><strong>Safety first</strong><span>Disconnect power before setup or service. Keep the manual’s PPE and ventilation rules in reach.</span></p></div>
        </aside>
        {sidebarOpen ? <button className="sidebar-scrim" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close source panel" /> : null}

        <main className="chat-main" id="top">
          {messages.length === 0 ? (
            <section className="welcome">
              <div className="welcome-badge"><Sparkles size={15} /> Visual answers from the actual manual</div>
              <h1>Good welds start<br />before the arc.</h1>
              <p>Ask a real setup or troubleshooting question. Arcwell cross-checks the OmniPro 220 source pack, then shows you the answer—not just a wall of text.</p>
              <div className="suggestion-grid">
                {SUGGESTIONS.map((suggestion) => (
                  <button type="button" key={suggestion.label} onClick={() => void sendMessage(suggestion.question)}>
                    <span className="suggestion-icon"><suggestion.icon size={19} /></span>
                    <span className="suggestion-label">{suggestion.label}</span>
                    <strong>{suggestion.question}</strong>
                    <small>{suggestion.hint}<ChevronRight size={14} /></small>
                  </button>
                ))}
              </div>
              <div className="welcome-trust"><span><SearchCheck size={15} /> 51 pages indexed</span><i /><span><ShieldCheck size={15} /> Exact-number lookups</span><i /><span><PanelLeftClose size={15} /> Real manual figures</span></div>
            </section>
          ) : (
            <section className="conversation" aria-live="polite">
              {messages.map((message) => message.role === "user" ? (
                <article className="message user-message" key={message.id}>
                  <div>{message.parts[0]?.type === "text" ? message.parts[0].text : ""}</div>
                  <span>You</span>
                </article>
              ) : <AssistantMessage key={message.id} message={message} onRepair={(repairMessage) => void sendMessage(repairMessage)} />)}
              <div ref={scrollAnchorRef} />
            </section>
          )}
          <Composer value={input} onChange={setInput} onSubmit={() => void sendMessage()} onStop={() => abortRef.current?.abort()} busy={busy} />
        </main>
      </div>
    </div>
  );
}
