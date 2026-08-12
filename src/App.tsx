import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioSelection,
  JobEvent,
  ProcessingFailure,
  ProcessingProgress,
  ProcessingResult,
} from "./types";

type Screen = "idle" | "working" | "done" | "error";

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+': Error: /, "")
    .replace(/^Error: /, "");
}

function WaveMark() {
  return (
    <svg aria-hidden="true" className="wave-mark" viewBox="0 0 48 48">
      <path d="M8 26v-4M14 32V16M20 38V10M26 34V14M32 29V19M38 26v-4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <path d="M16 22V7m0 0-6 6m6-6 6 6M7 22v3h18v-3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <path d="m8 16 5 5 11-12" />
    </svg>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("idle");
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [failure, setFailure] = useState<ProcessingFailure | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const currentJobId = useRef<string | null>(null);

  useEffect(() => {
    return window.sermonCleaner.onJobEvent((event: JobEvent) => {
      if (event.jobId !== currentJobId.current) return;
      if (event.state === "completed") {
        setResult(event);
        setScreen("done");
        setIsCancelling(false);
      } else if (event.state === "failed" || event.state === "cancelled") {
        setFailure(event);
        setScreen(event.state === "cancelled" ? "idle" : "error");
        setIsCancelling(false);
        if (event.state === "cancelled") {
          setSelection(null);
          setProgress(null);
          currentJobId.current = null;
        }
      } else {
        setProgress(event);
      }
    });
  }, []);

  const begin = useCallback(async (audio: AudioSelection) => {
    setSelection(audio);
    setFailure(null);
    setResult(null);
    setProgress(null);
    setScreen("working");
    try {
      const start = await window.sermonCleaner.startProcessing(audio.sourcePath);
      currentJobId.current = start.jobId;
    } catch (error) {
      setFailure({
        jobId: "not-started",
        state: "failed",
        code: "PROCESSING_FAILED",
        message: errorMessage(error),
      });
      setScreen("error");
    }
  }, []);

  const chooseFile = useCallback(async () => {
    if (screen === "working") return;
    try {
      const audio = await window.sermonCleaner.selectAudio();
      if (audio) await begin(audio);
    } catch (error) {
      setFailure({
        jobId: "selection",
        state: "failed",
        code: "INVALID_AUDIO",
        message: errorMessage(error),
      });
      setScreen("error");
    }
  }, [begin, screen]);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      if (screen === "working") return;
      const file = event.dataTransfer.files[0];
      if (!file) return;
      try {
        const audio = await window.sermonCleaner.registerDroppedFile(file);
        await begin(audio);
      } catch (error) {
        setFailure({
          jobId: "drop",
          state: "failed",
          code: "INVALID_AUDIO",
          message: errorMessage(error),
        });
        setScreen("error");
      }
    },
    [begin, screen],
  );

  const cancel = useCallback(async () => {
    if (!currentJobId.current || isCancelling) return;
    setIsCancelling(true);
    await window.sermonCleaner.cancelProcessing(currentJobId.current);
  }, [isCancelling]);

  const reset = useCallback(() => {
    currentJobId.current = null;
    setScreen("idle");
    setSelection(null);
    setProgress(null);
    setResult(null);
    setFailure(null);
    setIsCancelling(false);
  }, []);

  const percent = progress?.percent ?? (screen === "working" ? 0 : 100);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Sermon Audio Cleaner home">
          <span className="brand-icon"><WaveMark /></span>
          <span>Sermon Audio Cleaner</span>
        </a>
        <span className="privacy-chip">
          <span aria-hidden="true" className="privacy-dot" />
          Private &amp; offline
        </span>
      </header>

      <section className="hero" id="main">
        <p className="eyebrow">Clear voice. Consistent volume.</p>
        <h1>Make every word<br />easier to hear.</h1>
        <p className="lede">
          Drop in a sermon recording. We’ll reduce steady background noise,
          balance the volume, and save a polished MP3 automatically.
        </p>
      </section>

      <section className="workspace" aria-live="polite">
        {screen === "idle" && (
          <div
            className={`drop-card${isDragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsDragging(false);
              }
            }}
            onDrop={handleDrop}
          >
            <div className="drop-icon"><UploadIcon /></div>
            <h2>Drop your sermon here</h2>
            <p>MP3, WAV, M4A, FLAC, OGG, Opus, or WebM · up to 90 minutes</p>
            <div className="divider"><span>or</span></div>
            <button className="primary-button" type="button" onClick={chooseFile}>
              Choose recording
            </button>
            <p className="automatic-note">Processing starts automatically</p>
          </div>
        )}

        {screen === "working" && selection && (
          <div className="process-card">
            <div
              className="progress-ring"
              style={{ "--progress": `${percent * 3.6}deg` } as React.CSSProperties}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              aria-label="Audio processing progress"
            >
              <div>
                <strong>{Math.round(percent)}%</strong>
                <span>complete</span>
              </div>
            </div>
            <div className="process-copy">
              <p className="status-label">{progress?.message ?? "Preparing the recording…"}</p>
              <h2 title={selection.name}>{selection.name}</h2>
              <div className="file-meta">
                <span>{formatBytes(selection.sizeBytes)}</span>
                {progress?.durationSeconds ? (
                  <span>{formatDuration(progress.durationSeconds)}</span>
                ) : null}
                {progress ? <span>{formatDuration(progress.elapsedSeconds)} elapsed</span> : null}
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="wait-note">Long recordings may take several minutes. You can keep this window in the background.</p>
              <button className="text-button danger" type="button" onClick={cancel} disabled={isCancelling}>
                {isCancelling ? "Cancelling…" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {screen === "done" && result && (
          <div className="result-card">
            <div className="success-icon"><CheckIcon /></div>
            <p className="status-label">Cleaning complete</p>
            <h2>Your sermon is ready.</h2>
            <p className="result-name">{result.outputName}</p>
            <audio controls preload="metadata" src={result.audioUrl}>
              Your browser cannot play this audio preview.
            </audio>
            <p className="saved-path" title={result.outputPath}>
              Saved to <span>{result.outputPath}</span>
            </p>
            <div className="result-actions">
              <button className="primary-button" type="button" onClick={() => window.sermonCleaner.openOutput(result.jobId)}>
                Open cleaned MP3
              </button>
              <button className="secondary-button" type="button" onClick={() => window.sermonCleaner.revealOutput(result.jobId)}>
                Show in folder
              </button>
            </div>
            <button className="text-button" type="button" onClick={reset}>Clean another recording</button>
          </div>
        )}

        {screen === "error" && failure && (
          <div className="error-card" role="alert">
            <div className="error-icon" aria-hidden="true">!</div>
            <p className="status-label">Couldn’t clean this recording</p>
            <h2>The original file is safe.</h2>
            <p className="error-message">{failure.message}</p>
            <button className="primary-button" type="button" onClick={reset}>Choose another recording</button>
          </div>
        )}
      </section>

      <section className="trust-row" aria-label="How processing works">
        <div><strong>No uploads</strong><span>Your audio never leaves this device.</span></div>
        <div><strong>No AI</strong><span>Deterministic audio filters only.</span></div>
        <div><strong>No settings</strong><span>One balanced preset for spoken sermons.</span></div>
      </section>

      <footer>
        Best for steady hum, hiss, and fan noise. Sudden sounds, overlapping voices, and strong echo may remain.
      </footer>
    </main>
  );
}
