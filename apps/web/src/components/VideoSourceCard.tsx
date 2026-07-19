import { memo, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import type { VideoPayload } from "../types";

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export const VideoSourceCard = memo(function VideoSourceCard({ video }: { video: VideoPayload }) {
  const [playing, setPlaying] = useState(false);
  const { source } = video;
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(source.videoId)}?start=${source.startSeconds}&end=${source.endSeconds}&playsinline=1&rel=0&autoplay=1`;
  const timeRange = `${formatTime(source.startSeconds)}–${formatTime(source.endSeconds)}`;

  return (
    <section className="video-source-card" aria-labelledby={`video-title-${video.id}`}>
      <header>
        <span className="video-source-icon"><Play size={15} fill="currentColor" /></span>
        <div>
          <small>Video source · {timeRange}</small>
          <h3 id={`video-title-${video.id}`}>{source.title}</h3>
        </div>
        <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.title} on YouTube`}>
          YouTube <ExternalLink size={12} />
        </a>
      </header>
      <div className="video-source-stage">
        {playing ? (
          <iframe
            src={embedUrl}
            title={`${source.title}, ${timeRange}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${source.title}, ${timeRange}`}>
            <img src={source.previewUrl} alt="" loading="lazy" />
            <span><Play size={18} fill="currentColor" /> Play {timeRange}</span>
          </button>
        )}
      </div>
    </section>
  );
});
