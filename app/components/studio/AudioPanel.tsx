"use client";
import { Download, RefreshCw, Volume2 } from "lucide-react";
import type {
  Analysis,
  AudioMode,
  Character,
  Version,
} from "../../lib/studio/types";
import { assetUrl, seconds, speechInput } from "../../lib/studio/types";
import type { StudioAction } from "./Studio";
import { reenactmentRange } from "../../lib/studio/range";

const MODES: { id: AudioMode; name: string; description: string }[] = [
  {
    id: "ORIGINAL",
    name: "Original",
    description: "Keep the source performance and audio.",
  },
  {
    id: "CHARACTER_TTS",
    name: "Character voices",
    description: "Generate verbatim lines with saved voices.",
  },
  {
    id: "UPLOADED",
    name: "Uploaded recording",
    description: "Use your own recording or finished mix.",
  },
  {
    id: "SILENT",
    name: "Silent",
    description: "Export visuals with no audio track.",
  },
];
export function AudioPanel({
  analysis,
  version,
  characters,
  updateVersion,
  run,
  busy,
}: {
  analysis: Analysis;
  version: Version;
  characters: Character[];
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  busy: boolean;
}) {
  const range = reenactmentRange(analysis, version);
  return (
    <div className="stack">
      <section className="panel stack">
        <span className="eyebrow">03 / KEEP THE PERFORMANCE</span>
        <h2>Choose what your audience hears.</h2>
        <p className="muted">
          Original audio is the default. Each version can use a different mix
          without repeating video analysis.
        </p>
        <p className="hint">
          Export uses source {seconds(range.start)}–{seconds(range.end)}. Audio
          offsets are applied on the source timeline before this interval is
          trimmed.
        </p>
        <div className="mode-grid">
          {MODES.map((mode) => (
            <button
              className={`mode-card ${version.audioMode === mode.id ? "selected" : ""}`}
              key={mode.id}
              onClick={() => updateVersion({ audioMode: mode.id })}
            >
              <span className="radio-dot" />
              <strong>{mode.name}</strong>
              <span>{mode.description}</span>
              {mode.id === "ORIGINAL" && <small>DEFAULT · NO API COST</small>}
            </button>
          ))}
        </div>
        <label className="narrow-field">
          Global audio offset (seconds)
          <input
            type="number"
            step="0.01"
            value={version.audioOffset}
            onChange={(e) =>
              updateVersion({ audioOffset: Number(e.target.value) })
            }
          />
          <span className="hint">
            Positive delays audio; negative starts the recording earlier.
          </span>
        </label>
      </section>
      {version.audioMode === "ORIGINAL" && (
        <section className="panel stack">
          <h3>The original soundtrack, preserved.</h3>
          <p className="muted">
            Dialogue, music, room sound and effects remain together. No TTS or
            voice conversion is applied. Export encodes the soundtrack to AAC
            for MP4.
          </p>
          {analysis.media.hasAudio ? (
            <>
              <audio controls src={assetUrl(analysis.sourceAsset)} />
              <button
                className="button fit"
                disabled={busy}
                onClick={() => run("extract_audio")}
              >
                <Download size={15} />
                Extract reusable original WAV
              </button>
            </>
          ) : (
            <p className="notice">This source has no audio stream.</p>
          )}
        </section>
      )}
      {version.audioMode === "UPLOADED" && (
        <section className="panel stack">
          <h3>Your own recording.</h3>
          <label className="upload-zone small">
            Upload a finished recording
            <input
              type="file"
              accept=".wav,.mp3,.m4a,.flac,.ogg"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) run("upload_audio", { role: "uploadedAudio" }, f);
              }}
            />
            <span>WAV, MP3, M4A, FLAC, OGG</span>
          </label>
          {version.uploadedAudio && (
            <audio controls src={assetUrl(version.uploadedAudio)} />
          )}
          <p className="hint">
            Short recordings are padded with silence. Longer recordings are
            trimmed to the selected source interval. Recordings align to the
            full source timeline; use the audio offset to position a shorter
            recording.
          </p>
        </section>
      )}
      {version.audioMode === "CHARACTER_TTS" && (
        <>
          <section className="panel stack">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">PER-TURN AUDIO</span>
                <h3>One speaker. One reusable take.</h3>
              </div>
              <span className="badge">{analysis.turns.length} lines</span>
            </div>
            <p className="muted">
              Dialogue is sent exactly as saved, including profanity. Delivery
              style is separate metadata. Generate a line, listen, then adjust
              its start or speed to fit.
            </p>
            {!analysis.turns.length && (
              <p className="empty-note">
                Add or analyze dialogue in Source & analysis first.
              </p>
            )}
            {analysis.turns.map((turn, i) => {
              const character = characters.find(
                (c) => c.id === version.mappings[turn.speakerId],
              );
              const takes = version.audioTakes[turn.id] || [];
              const take =
                takes.find((t) => t.asset === version.selectedTakes[turn.id]) ||
                takes.at(-1);
              const timing = version.turnTiming[turn.id] || {
                offset: 0,
                speed: 1,
              };
              const speed = timing.speed * (character?.voice.speed || 1);
              const duration = take ? take.duration / speed : 0;
              const stale = Boolean(
                take &&
                character &&
                take.inputFingerprint !==
                  JSON.stringify(speechInput(turn, character.voice)),
              );
              const overflow =
                turn.start + timing.offset + version.audioOffset + duration >
                turn.end + 0.04;
              const timingPatch = (patch: Partial<typeof timing>) =>
                updateVersion({
                  turnTiming: {
                    ...version.turnTiming,
                    [turn.id]: { ...timing, ...patch },
                  },
                });
              return (
                <div className="edit-card stack" key={turn.id}>
                  <div className="panel-heading">
                    <div className="inline">
                      <span className="turn-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <strong>{character?.name || "Unmapped actor"}</strong>
                      <span className="badge">{turn.emotion || "Natural"}</span>
                    </div>
                    <span className="mono">
                      {seconds(turn.start)} → {seconds(turn.end)}
                    </span>
                  </div>
                  <blockquote>{turn.text}</blockquote>
                  <p className="hint">
                    {character
                      ? `${character.voice.voiceId} · ${character.voice.model}`
                      : "Map this actor to a character in the library first."}
                    {!turn.reviewed && " · Transcript awaits review"}
                  </p>
                  <div className="inline wrap">
                    <button
                      className="button"
                      disabled={busy || !character}
                      onClick={() => run("generate_line", { turnId: turn.id })}
                    >
                      <Volume2 size={14} />
                      {take
                        ? "Reuse / generate current voice"
                        : "Generate line · API charge"}
                    </button>
                    {take && (
                      <button
                        className="button"
                        disabled={busy || !character}
                        onClick={() =>
                          run("generate_line", {
                            turnId: turn.id,
                            regenerate: true,
                          })
                        }
                      >
                        <RefreshCw size={14} />
                        New take · API charge
                      </button>
                    )}
                    {take && (
                      <a
                        className="text-link"
                        href={assetUrl(take.asset)}
                        download
                      >
                        Download WAV
                      </a>
                    )}
                  </div>
                  {stale && (
                    <p className="notice">
                      The dialogue or saved voice changed. Generate the current
                      line before assembly; previous takes remain available.
                    </p>
                  )}
                  {take && (
                    <>
                      <audio
                        key={`${take.asset}-${speed}`}
                        controls
                        src={assetUrl(take.asset)}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.playbackRate = speed;
                        }}
                      />
                      <div className="three-cols">
                        <label>
                          Saved take
                          <select
                            value={take.asset}
                            disabled={busy}
                            onChange={(e) =>
                              run("select_take", {
                                turnId: turn.id,
                                value: e.target.value,
                              })
                            }
                          >
                            {takes.map((t, n) => (
                              <option value={t.asset} key={t.asset}>
                                Take {n + 1} · {seconds(t.duration)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Start offset (s)
                          <input
                            type="number"
                            step="0.01"
                            value={timing.offset}
                            onChange={(e) =>
                              timingPatch({ offset: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Line speed
                          <input
                            type="number"
                            min="0.5"
                            max="2"
                            step="0.05"
                            value={timing.speed}
                            onChange={(e) =>
                              timingPatch({ speed: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <p className={overflow ? "notice" : "hint"}>
                        {seconds(duration)} generated ·{" "}
                        {seconds(turn.end - turn.start)} allocated
                        {overflow
                          ? " — exceeds its time window. Adjust speed or timing; words stay unchanged."
                          : " · Check the take matches the current saved voice before export."}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </section>
          <section className="panel stack">
            <h3>Optional background stem</h3>
            <p className="muted">
              Upload music and effects already separated from the original
              dialogue. This stem is mixed only with CHARACTER_TTS.
            </p>
            <input
              type="file"
              disabled={busy}
              accept=".wav,.mp3,.m4a,.flac,.ogg"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) run("upload_audio", { role: "backgroundAudio" }, f);
              }}
            />
            {version.backgroundAudio && (
              <audio src={assetUrl(version.backgroundAudio)} controls />
            )}
            <span className="hint">
              Automatic source separation is an optional external preprocessing
              step. Source audio alone is never presented as a clean background
              stem.
            </span>
          </section>
        </>
      )}
      <p className="notice">
        Generated mouth movements may not match final audio. Preview imported
        clips and adjust timing before export.
      </p>
    </div>
  );
}
