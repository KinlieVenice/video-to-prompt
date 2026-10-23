"use client";
import { useState } from "react";
import { Check, Plus, Scissors, Sparkles, Trash2 } from "lucide-react";
import type { Analysis, Shot, Speaker, Turn } from "../../lib/studio/types";
import { assetUrl, seconds } from "../../lib/studio/types";
import type { StudioAction } from "./Studio";

export function SourcePanel({
  analysis,
  run,
  busy,
}: {
  analysis: Analysis;
  run: StudioAction;
  busy: boolean;
}) {
  const [shots, setShots] = useState<Shot[]>(analysis.shots);
  const [speakers, setSpeakers] = useState<Speaker[]>(analysis.speakers);
  const [turns, setTurns] = useState<Turn[]>(analysis.turns);
  const [split, setSplit] = useState(1);
  const [dirty, setDirty] = useState(false);
  const changeShot = (id: string, patch: Partial<Shot>) => {
    setShots((items) =>
      items.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
    setDirty(true);
  };
  const changeTurn = (id: string, patch: Partial<Turn>) => {
    setTurns((items) =>
      items.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    setDirty(true);
  };
  const cut = () => {
    const shot = shots.find((s) => s.start < split && s.end > split);
    if (!shot) return;
    setShots((items) =>
      items.flatMap((s) =>
        s.id === shot.id
          ? [
              { ...s, end: split },
              { ...s, id: crypto.randomUUID(), start: split },
            ]
          : [s],
      ),
    );
    setDirty(true);
  };
  return (
    <div className="stack">
      <div className="source-grid">
        <section className="panel preview-panel">
          <div className="panel-heading">
            <span className="eyebrow">SOURCE FOOTAGE</span>
            <span className="badge">
              {analysis.status === "LOCAL"
                ? "Local scan complete"
                : "Gemini analyzed"}
            </span>
          </div>
          <video
            key={analysis.sourceAsset}
            src={assetUrl(analysis.sourceAsset)}
            controls
            playsInline
            preload="metadata"
          />
          <div className="preview-caption">
            <span>{analysis.sourceName}</span>
            <span>
              {seconds(analysis.media.duration)} · {analysis.media.width} ×{" "}
              {analysis.media.height}
            </span>
          </div>
        </section>
        <section className="panel stack">
          <span className="eyebrow">01 / UNDERSTAND THE PERFORMANCE</span>
          <h2>Start with what happened.</h2>
          <p className="muted">
            Cuts and audio activity are measured locally. Gemini adds the visual
            performance and a separate speaker transcript.
          </p>
          <div className="stat-grid">
            <div>
              <strong>{shots.length}</strong>
              <span>camera shots</span>
            </div>
            <div>
              <strong>{turns.length}</strong>
              <span>speaker turns</span>
            </div>
            <div>
              <strong>{speakers.length}</strong>
              <span>original actors</span>
            </div>
          </div>
          <button
            className="button primary"
            disabled={busy || analysis.status === "ANALYZED" || dirty}
            onClick={() => run("analyze")}
          >
            <Sparkles size={16} />
            {analysis.status === "ANALYZED"
              ? "Analysis saved for reuse"
              : "Analyze with Gemini"}
          </button>
          <span className="hint">
            Two API calls: visual analysis + audio transcription. Changing your
            cast never repeats analysis.
          </span>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CAMERA TIMELINE</span>
            <h3>Every cut gets its own reference.</h3>
          </div>
          <div className="inline">
            <label className="compact-label">
              Split at{" "}
              <input
                type="number"
                step="0.001"
                min="0"
                max={analysis.media.duration}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </label>
            <button className="button" onClick={cut} disabled={busy}>
              <Scissors size={14} />
              Split shot
            </button>
          </div>
        </div>
        <div className="shot-strip">
          {shots.map((s, i) => (
            <a
              href={`#shot-${s.id}`}
              key={s.id}
              style={{ flex: Math.max(0.5, s.end - s.start) }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <small>{seconds(s.start)}</small>
            </a>
          ))}
        </div>
        <div className="timeline-legend">
          <span>
            <i className="dot" />
            FFmpeg shot boundaries
          </span>
          <span>
            {analysis.activity.length} audio activity intervals · review music
            and effects
          </span>
        </div>
        <details>
          <summary>Edit shot boundaries, motion and camera</summary>
          <div className="stack">
            {shots.map((s, i) => (
              <div className="edit-card" id={`shot-${s.id}`} key={s.id}>
                <div className="panel-heading">
                  <strong>Shot {i + 1}</strong>
                  <div className="inline">
                    <span className="mono">
                      {seconds(s.start)} → {seconds(s.end)}
                    </span>
                    {i > 0 && (
                      <button
                        className="icon-button"
                        aria-label={`Remove cut before shot ${i + 1}`}
                        title="Remove this cut and merge with previous shot"
                        onClick={() => {
                          const updated = [...shots];
                          updated[i - 1] = { ...updated[i - 1], end: s.end };
                          updated.splice(i, 1);
                          setShots(updated);
                          setDirty(true);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {i < shots.length - 1 && (
                  <label>
                    Cut after this shot (seconds)
                    <input
                      type="number"
                      step="0.001"
                      value={s.end}
                      onChange={(e) => {
                        const end = Number(e.target.value);
                        setShots((items) =>
                          items.map((v, n) =>
                            n === i
                              ? { ...v, end }
                              : n === i + 1
                                ? { ...v, start: end }
                                : v,
                          ),
                        );
                        setDirty(true);
                      }}
                    />
                  </label>
                )}
                <label>
                  Scene and actor positions
                  <textarea
                    rows={2}
                    value={s.description}
                    onChange={(e) =>
                      changeShot(s.id, { description: e.target.value })
                    }
                  />
                </label>
                <div className="two-cols">
                  <label>
                    Camera
                    <input
                      value={s.camera}
                      onChange={(e) =>
                        changeShot(s.id, { camera: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Lighting
                    <input
                      value={s.lighting}
                      onChange={(e) =>
                        changeShot(s.id, { lighting: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Timestamped motion and gestures
                  <textarea
                    value={s.motion}
                    rows={2}
                    onChange={(e) =>
                      changeShot(s.id, { motion: e.target.value })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        </details>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SPEAKER LABELS</span>
            <h3>Identify the original actors.</h3>
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              setSpeakers((items) => [
                ...items,
                {
                  id: crypto.randomUUID(),
                  name: `Actor ${items.length + 1}`,
                  description: "",
                },
              ]);
              setDirty(true);
            }}
          >
            <Plus size={14} />
            Add actor
          </button>
        </div>
        <div className="cast-grid">
          {speakers.map((s) => (
            <div className="edit-card" key={s.id}>
              <label>
                Actor label
                <input
                  value={s.name}
                  onChange={(e) => {
                    setSpeakers((items) =>
                      items.map((v) =>
                        v.id === s.id ? { ...v, name: e.target.value } : v,
                      ),
                    );
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                Appearance / position / audible voice
                <textarea
                  rows={2}
                  value={s.description}
                  onChange={(e) => {
                    setSpeakers((items) =>
                      items.map((v) =>
                        v.id === s.id
                          ? { ...v, description: e.target.value }
                          : v,
                      ),
                    );
                    setDirty(true);
                  }}
                />
              </label>
            </div>
          ))}
        </div>
        {!speakers.length && (
          <p className="muted">
            Analyze the source, or add actors and transcribe manually.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">VERBATIM TRANSCRIPT</span>
            <h3>Keep the words. Correct the timing.</h3>
          </div>
          <button
            className="button"
            disabled={busy || !speakers.length}
            onClick={() => {
              setTurns((items) => [
                ...items,
                {
                  id: crypto.randomUUID(),
                  speakerId: speakers[0].id,
                  start: 0,
                  end: Math.min(2, analysis.media.duration),
                  text: "",
                  emotion: "",
                  gesture: "",
                  reviewed: false,
                },
              ]);
              setDirty(true);
            }}
          >
            <Plus size={14} />
            Add turn
          </button>
        </div>
        <p className="muted">
          Review AI words against the source. Filipino, English, Taglish and
          profanity are kept as entered. Dialogue may span camera cuts.
        </p>
        <div className="stack">
          {turns.map((t, i) => (
            <div className="edit-card" key={t.id}>
              <div className="turn-heading">
                <span className="turn-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <select
                  aria-label={`Speaker for line ${i + 1}`}
                  value={t.speakerId}
                  onChange={(e) =>
                    changeTurn(t.id, { speakerId: e.target.value })
                  }
                >
                  {speakers.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <label className="compact-label">
                  In
                  <input
                    aria-label={`Start of line ${i + 1}`}
                    type="number"
                    step="0.01"
                    value={t.start}
                    onChange={(e) =>
                      changeTurn(t.id, { start: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="compact-label">
                  Out
                  <input
                    aria-label={`End of line ${i + 1}`}
                    type="number"
                    step="0.01"
                    value={t.end}
                    onChange={(e) =>
                      changeTurn(t.id, { end: Number(e.target.value) })
                    }
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label={`Delete line ${i + 1}`}
                  onClick={() => {
                    setTurns((items) => items.filter((v) => v.id !== t.id));
                    setDirty(true);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                aria-label={`Dialogue line ${i + 1}`}
                value={t.text}
                rows={2}
                placeholder="Exact original dialogue…"
                onChange={(e) =>
                  changeTurn(t.id, { text: e.target.value, reviewed: false })
                }
              />
              <div className="two-cols">
                <label>
                  Emotion / delivery
                  <input
                    placeholder="Anger, shouting, whispering, laughter…"
                    value={t.emotion}
                    onChange={(e) =>
                      changeTurn(t.id, { emotion: e.target.value })
                    }
                  />
                </label>
                <label>
                  Gesture
                  <input
                    value={t.gesture}
                    onChange={(e) =>
                      changeTurn(t.id, { gesture: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={t.reviewed}
                  onChange={(e) =>
                    changeTurn(t.id, { reviewed: e.target.checked })
                  }
                />
                Checked against source audio
              </label>
            </div>
          ))}
        </div>
      </section>
      <div className="save-bar">
        <span>
          {dirty
            ? "Unsaved source corrections"
            : "Analysis saved independently of characters and voices"}
        </span>
        <button
          className="button primary"
          disabled={busy || !dirty}
          onClick={async () => {
            const result = await run("save_analysis", {
              value: { shots, speakers, turns },
            });
            if (result) setDirty(false);
          }}
        >
          <Check size={15} />
          Save transcript & timeline
        </button>
      </div>
      <details className="panel">
        <summary>Timing evidence and analysis notes</summary>
        {analysis.warnings.map((w, i) => (
          <p className="hint" key={i}>
            {w}
          </p>
        ))}
        <pre className="small-code">
          {JSON.stringify(analysis.activity, null, 2)}
        </pre>
      </details>
    </div>
  );
}
