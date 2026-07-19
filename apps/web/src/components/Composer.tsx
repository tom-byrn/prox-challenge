import { memo, useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import type { PhotoDraft } from "../lib/photos";

type Props = {
  value: string;
  photo?: PhotoDraft;
  photoError?: string;
  onChange: (value: string) => void;
  onPhotoSelect: (file: File) => void;
  onPhotoRemove: () => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
};

export const Composer = memo(function Composer({ value, photo, photoError, onChange, onPhotoSelect, onPhotoRemove, onSubmit, onStop, busy }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const canSubmit = Boolean(value.trim() || photo);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <div className="composer-wrap">
      <div
        className={`composer${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (!busy && file) onPhotoSelect(file);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPhotoSelect(file);
            event.target.value = "";
          }}
        />
        {photo ? (
          <div className="composer-photo-preview">
            <img src={photo.previewUrl} alt="Selected upload preview" />
            <div><strong>{photo.file.name}</strong><small>{(photo.file.size / 1024 / 1024).toFixed(1)} MB · ready to inspect</small></div>
            <button type="button" aria-label="Remove attached photo" onClick={onPhotoRemove} disabled={busy}><X size={14} /></button>
          </div>
        ) : null}
        {photoError ? <div className="composer-photo-error" role="alert">{photoError}</div> : null}
        <div className="composer-input-row">
          <button
            className="attach-photo-button"
            type="button"
            aria-label="Attach a photo"
            title="Attach a photo"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={18} />
          </button>
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            placeholder={photo ? "What should I check in this photo?" : "Ask about the OmniPro 220…"}
            aria-label="Message the OmniPro 220 assistant"
            onChange={(event) => onChange(event.target.value)}
            onPaste={(event) => {
              const file = [...event.clipboardData.files].find((candidate) => candidate.type.startsWith("image/"));
              if (file && !busy) {
                event.preventDefault();
                onPhotoSelect(file);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!busy && canSubmit) onSubmit();
              }
            }}
          />
          <button className={busy ? "stop-button" : "send-button"} type="button" onClick={busy ? onStop : onSubmit} disabled={!busy && !canSubmit} aria-label={busy ? "Stop response" : "Send message"}>
            {busy ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
          </button>
        </div>
        {dragging ? <div className="composer-drop-hint">Drop the photo to attach it</div> : null}
      </div>
    </div>
  );
});
