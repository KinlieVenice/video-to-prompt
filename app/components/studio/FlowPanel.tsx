"use client";
import { useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Film,
  ImagePlus,
  Scissors,
  Sparkles,
} from "lucide-react";
import type {
  Analysis,
  Character,
  Frames,
  Segment,
  Version,
} from "../../lib/studio/types";
import {
  assetUrl,
  IMAGE_MODELS,
  seconds,
  STRATEGIES,
} from "../../lib/studio/types";
import { supportedDurations } from "../../lib/studio/services/ScenePlannerService";
import { PromptGenerationService } from "../../lib/studio/services/PromptGenerationService";
import type { StudioAction } from "./Studio";
import { segmentMotionText } from "../../lib/studio/motion";
import { reenactmentRange } from "../../lib/studio/range";
import { assemblyTimeline } from "../../lib/studio/assembly";
import { visualDirection } from "../../lib/studio/visualDirection";
import { appearanceNotes } from "../../lib/studio/appearance";
import { VisualDirectionControls } from "./VisualDirectionControls";
import { FlowBridgePanel } from "./FlowBridgePanel";
import {
  continuousPredecessor,
  referenceLinkCurrent,
} from "../../lib/studio/references";

function ScenePreview({
  analysis,
  segment,
}: {
  analysis: Analysis;
  segment: Segment;
}) {
  return (
    <video
      src={assetUrl(analysis.sourceAsset)}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = segment.start;
      }}
      onPlay={(e) => {
        if (
          e.currentTarget.currentTime < segment.start ||
          e.currentTarget.currentTime >= segment.end
        )
          e.currentTarget.currentTime = segment.start;
      }}
      onTimeUpdate={(e) => {
        if (e.currentTarget.currentTime >= segment.end) e.currentTarget.pause();
      }}
    />
  );
}

function FramePair({
  frames,
  segmentNumber,
  source = false,
}: {
  frames?: Pick<Frames, "first" | "last">;
  segmentNumber: number;
  source?: boolean;
}) {
  return (
    <div
      className={`frame-pair ${source ? "source-frame-pair" : "replacement-frame-pair"}`}
      role="group"
      aria-label={`${source ? "Original source" : "Generated replacement"} frames for segment ${segmentNumber}`}
    >
      {(["first", "last"] as const).map((which) => {
        const asset = frames?.[which];
        const kind = source ? "Original source" : "Generated replacement";
        return (
          <div className="frame-slot" key={which}>
            {asset ? (
              <a
                href={assetUrl(asset)}
                download
                aria-label={`Download ${kind.toLowerCase()} ${which} frame for segment ${segmentNumber}`}
              >
                <img
                  src={assetUrl(asset)}
                  alt={`${kind} ${which} frame for segment ${segmentNumber}`}
                />
              </a>
            ) : (
              <ImagePlus size={23} />
            )}
            <span>
              {which.toUpperCase()} FRAME ·{" "}
              {source
                ? "ORIGINAL SOURCE"
                : asset
                  ? "GENERATED"
                  : "NOT GENERATED"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function FlowPanel({
  projectId,
  onImported,
  analysis,
  version,
  characters,
  updateVersion,
  run,
  busy,
}: {
  projectId: string;
  onImported: () => Promise<void>;
  analysis: Analysis;
  version: Version;
  characters: Character[];
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  busy: boolean;
}) {
  const [model, setModel] = useState(IMAGE_MODELS[0]);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const stale = version.planRevision !== analysis.revision;
  const total = version.segments.reduce((n, s) => n + s.credits, 0);
  const generatedPairs = version.segments.filter(
    (segment) =>
      version.frames[segment.id]?.generated?.first &&
      version.frames[segment.id]?.generated?.last,
  ).length;
  const range = reenactmentRange(analysis, version);
  let assembly: ReturnType<typeof assemblyTimeline> = [];
  try {
    assembly = assemblyTimeline(analysis, version);
  } catch {
    // Export displays missing clips or timing conflicts with the full plan.
  }
  const direction = visualDirection(version);
  const actorNotes = appearanceNotes(version);
  const needsBackground =
    direction.backgroundMode === "NEW" && !direction.backgroundPrompt;
  const copy = async (id: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(id);
      setCopyError("");
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopyError(
        "Clipboard unavailable. Select and copy the prompt text below.",
      );
    }
  };
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">04 / MANUAL GENERATION WORKSPACE</span>
            <h2>A shot-by-shot handoff to Flow.</h2>
          </div>
          <a
            className="button"
            href="https://labs.google/fx/tools/flow"
            target="_blank"
            rel="noreferrer"
          >
            Open Google Flow
            <ExternalLink size={14} />
          </a>
        </div>
        <p className="muted">
          Prepare image references and a motion prompt, generate each clip in
          Google Flow, then upload the result here.
        </p>
        <VisualDirectionControls
          version={version}
          updateVersion={updateVersion}
          run={run}
          busy={busy}
        />
        <div className="three-cols">
          <label>
            Manual generation target
            <select
              value={version.target}
              onChange={(e) =>
                updateVersion({
                  ...(e.target.value === "VEO_LITE" && version.flowSettings
                    ? {
                        flowSettings: {
                          ...version.flowSettings,
                          resolution: "720p" as const,
                        },
                      }
                    : {}),
                  target: e.target.value as Version["target"],
                  maxDuration:
                    e.target.value === "VEO_LITE"
                      ? version.strategy === "INGREDIENTS"
                        ? 8
                        : Math.min(8, version.maxDuration)
                      : version.maxDuration,
                  strategy:
                    version.strategy === "EXTEND" &&
                    e.target.value !== "VEO_LITE"
                      ? "FIRST_LAST"
                      : version.strategy,
                })
              }
            >
              <option value="VEO_LITE">Veo 3.1 Lite</option>
              <option value="OMNI_FLASH">Omni 1.1 Flash</option>
            </select>
          </label>
          <label>
            Maximum generation duration
            <select
              value={version.maxDuration}
              onChange={(e) =>
                updateVersion({ maxDuration: Number(e.target.value) })
              }
            >
              {supportedDurations(version.target, version.strategy).map((d) => (
                <option key={d} value={d}>
                  {d} seconds
                </option>
              ))}
            </select>
          </label>
          <label>
            Generation strategy
            <select
              value={version.strategy}
              onChange={(e) =>
                updateVersion({
                  strategy: e.target.value as Version["strategy"],
                  ...(version.target === "VEO_LITE" &&
                  ["INGREDIENTS", "EXTEND"].includes(e.target.value)
                    ? { maxDuration: 8 }
                    : {}),
                })
              }
            >
              {Object.entries(STRATEGIES)
                .filter(
                  ([key]) => key !== "EXTEND" || version.target === "VEO_LITE",
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="three-cols">
          <label>
            Controlled overlap (s)
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={version.overlap}
              onChange={(e) =>
                updateVersion({ overlap: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Credits per generation override
            <input
              type="number"
              min="0"
              placeholder="Use official baseline"
              value={version.creditOverride ?? ""}
              onChange={(e) =>
                updateVersion({
                  creditOverride:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Image provider model
            <input
              list="image-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id="image-models">
              {IMAGE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </datalist>
            <span className="hint">
              Full reference-capable 9router image model ID. Enable the optional
              image route in Settings first.
            </span>
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={version.ultra}
            onChange={(e) => updateVersion({ ultra: e.target.checked })}
          />
          Use Ultra credit rate for Veo Lite
        </label>
        <div className="inline wrap">
          <button
            className="button primary"
            disabled={busy || needsBackground}
            onClick={() => run("plan")}
          >
            <Scissors size={15} />
            {version.segments.length ? "Replan segments" : "Plan segments"}
          </button>
          <button
            className="button"
            disabled={
              busy || needsBackground || !version.segments.length || stale
            }
            onClick={() => run("package")}
          >
            <Download size={15} />
            Download Flow package
          </button>
          <span className="hint">
            Replanning replaces this version’s frame and clip assignments; saved
            assets remain on disk.
          </span>
        </div>
      </section>
      <FlowBridgePanel
        projectId={projectId}
        version={version}
        updateVersion={updateVersion}
        run={run}
        onImported={onImported}
        disabled={busy}
        stale={stale}
      />
      <div className="cost-strip">
        <div>
          <strong>{version.segments.length}</strong>
          <span>planned generations</span>
        </div>
        <div>
          <strong>{total}</strong>
          <span>estimated Flow credits</span>
        </div>
        <div>
          <strong>{seconds(range.end - range.start)}</strong>
          <span>
            selected source {seconds(range.start)}–{seconds(range.end)}
          </span>
        </div>
        <a
          className="text-link"
          href="https://support.google.com/flow/answer/16526234?hl=en"
          target="_blank"
          rel="noreferrer"
        >
          Credit rates ↗
        </a>
      </div>
      <p className="hint">
        Baseline checked 23 Oct 2026. One generation per segment, before
        retries, variants or upscaling. Credits are separate from OpenAI /
        9router charges. Confirm the current quote in Flow.
      </p>
      {stale && version.segments.length > 0 && (
        <p className="notice">
          The analysis or plan settings changed. Replan before generating
          references, importing clips or exporting.
        </p>
      )}
      {copyError && <p className="notice">{copyError}</p>}
      {version.segments.length > 0 && (
        <p className="hint" role="status">
          {generatedPairs}/{version.segments.length} segments have generated
          replacement frame pairs. Source previews and source pose references
          retain the original cast.
        </p>
      )}
      {!version.segments.length && (
        <section className="panel empty-workspace">
          <Film size={38} />
          <h3>Turn the timeline into a generation plan.</h3>
          <p className="muted">
            Short shots get their own references. Longer continuous shots split
            near pauses, with optional controlled overlap.
          </p>
        </section>
      )}
      {version.segments.map((segment, i) => {
        const shot = analysis.shots.find((s) => s.id === segment.shotId);
        const frames = version.frames[segment.id];
        const clip = version.clips[segment.id];
        const placement = assembly[i];
        const turns = analysis.turns.filter(
          (t) => t.end > segment.start && t.start < segment.end,
        );
        const prompt = PromptGenerationService.generate(
          analysis,
          version,
          segment,
          characters,
        );
        const cast = characters.filter((c) =>
          Object.values(version.mappings).includes(c.id),
        );
        return (
          <section className="panel segment-card" key={segment.id}>
            <div className="panel-heading">
              <div className="inline">
                <span className="segment-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>
                    {seconds(segment.start)} — {seconds(segment.end)}
                  </h3>
                  <p className="hint">
                    {STRATEGIES[segment.strategy]} · {segment.duration}s
                    generation · trim to {seconds(segment.end - segment.start)}
                  </p>
                </div>
              </div>
              <span className="badge">{segment.credits} credits</span>
            </div>
            <div className="segment-grid">
              <div className="stack">
                <div className="scene-preview">
                  <ScenePreview analysis={analysis} segment={segment} />
                  <span>
                    SOURCE VIDEO · ORIGINAL CAST · {version.audioMode}
                  </span>
                </div>
                <p className="muted">
                  {shot?.description ||
                    "Add a shot description in Source & analysis."}
                </p>
                <div className="mapping-chips">
                  {analysis.speakers.map((s) => (
                    <span className="badge" key={s.id}>
                      {s.name} →{" "}
                      {characters.find((c) => c.id === version.mappings[s.id])
                        ?.name || "Original"}
                    </span>
                  ))}
                </div>
                <div className="dialogue-excerpt">
                  {analysis.speakers
                    .filter(
                      (actor) =>
                        version.mappings[actor.id] && actorNotes[actor.id],
                    )
                    .map((actor) => (
                      <p className="hint" key={`appearance-${actor.id}`}>
                        <strong>{actor.name} appearance:</strong>{" "}
                        {actorNotes[actor.id]}
                      </p>
                    ))}
                  {turns.length ? (
                    turns.map((t) => (
                      <p key={t.id}>
                        <span className="mono">
                          {seconds(t.start)} /{" "}
                          {
                            analysis.speakers.find((s) => s.id === t.speakerId)
                              ?.name
                          }
                        </span>
                        <br />
                        {t.text}
                      </p>
                    ))
                  ) : (
                    <p className="hint">No dialogue in this interval.</p>
                  )}
                </div>
                {segment.continuationOf && (
                  <p className="hint">
                    Continue segment{" "}
                    {version.segments.findIndex(
                      (s) => s.id === segment.continuationOf,
                    ) + 1}{" "}
                    within this continuous shot.
                  </p>
                )}
                {segment.warnings.map((w, n) => (
                  <p className="notice" key={n}>
                    {w}
                  </p>
                ))}
              </div>
              <div className="stack">
                <div className="panel-heading">
                  <span className="eyebrow">REPLACEMENT FRAME REFERENCES</span>
                  <button
                    className="button small-button"
                    disabled={busy || stale}
                    onClick={() =>
                      run("extract_frames", { segmentId: segment.id })
                    }
                  >
                    <Film size={13} />
                    Extract original frames
                  </button>
                </div>
                <FramePair frames={frames?.generated} segmentNumber={i + 1} />
                <p className={frames?.generated ? "hint" : "notice"}>
                  {frames?.generated
                    ? `Generated frames for ${cast.map((character) => character.name).join(", ") || "the mapped cast"}. Review the character identity before using them in Flow.`
                    : "Replacement frames have not been generated for this segment. Extract original frames saves source images; click Generate replaced frames to create your chosen cast."}
                </p>
                {continuousPredecessor(version, segment) && (
                  <p className="hint">
                    Continuous shot: generate the preceding segment's references
                    first to reuse its final replaced pose as this segment's
                    first frame.
                  </p>
                )}
                {frames?.generated?.inheritedFrom && (
                  <p
                    className={
                      referenceLinkCurrent(version, segment) ? "hint" : "notice"
                    }
                  >
                    {referenceLinkCurrent(version, segment)
                      ? "First replaced frame reuses the preceding segment's final pose."
                      : "The preceding reference changed. Regenerate these references to restore continuity."}
                  </p>
                )}
                <button
                  className="button fit"
                  disabled={busy || stale || needsBackground}
                  onClick={() =>
                    run("generate_frames", { segmentId: segment.id, model })
                  }
                >
                  <Sparkles size={14} />
                  Generate replaced frames · up to 2 image charges
                </button>
                {frames && (
                  <details>
                    <summary>Source frame references · original cast</summary>
                    <FramePair frames={frames} segmentNumber={i + 1} source />
                    <p className="hint">
                      These images were extracted from the uploaded video and
                      retain its original actors. Download generated replacement
                      images from the slots above for your chosen cast.
                    </p>
                  </details>
                )}
                {!!frames?.moments?.length && (
                  <div className="stack">
                    <span className="eyebrow">
                      KEY ACTION POSES · ORIGINAL SOURCE CAST
                    </span>
                    <div className="character-references">
                      {frames.moments.map((moment) => (
                        <a
                          key={moment.beatId}
                          href={assetUrl(moment.asset)}
                          download
                        >
                          <img
                            src={assetUrl(moment.asset)}
                            alt={`Source key pose at ${moment.time.toFixed(3)} seconds`}
                          />
                          <small>
                            {(moment.time - segment.start).toFixed(3)}s in
                            segment
                          </small>
                        </a>
                      ))}
                    </div>
                    <p className="hint">
                      Original actors are visible in these pose references. Use
                      them for motion/composition and your Flow character for
                      identity.
                    </p>
                  </div>
                )}
                <div className="character-references">
                  {cast.flatMap((c) =>
                    c.references.map((asset, n) => (
                      <a
                        href={assetUrl(asset)}
                        download
                        key={`${c.id}-${asset}`}
                      >
                        <img
                          src={assetUrl(asset)}
                          alt={`${c.name} reference ${n + 1}`}
                        />
                        <small>{c.name}</small>
                      </a>
                    )),
                  )}
                </div>
                <details>
                  <summary>Timestamped motion plan</summary>
                  <p className="small-code">
                    {shot
                      ? segmentMotionText(shot, segment)
                      : "Add motion beats in Source & analysis."}
                  </p>
                </details>
                <div className="prompt-box">
                  <div className="panel-heading">
                    <span className="eyebrow">FLOW PROMPT</span>
                    <button
                      className="button small-button"
                      disabled={busy || needsBackground}
                      onClick={() => copy(segment.id, prompt)}
                    >
                      <Copy size={13} />
                      {copied === segment.id ? "Copied" : "Copy prompt"}
                    </button>
                  </div>
                  <textarea
                    aria-label={`Flow prompt for segment ${i + 1}`}
                    readOnly
                    rows={8}
                    value={prompt}
                  />
                </div>
              </div>
            </div>
            <div className="clip-import">
              <div>
                <strong>
                  {clip
                    ? "Generated clip ready"
                    : "Bring the generated clip back."}
                </strong>
                <p className="hint">
                  {clip
                    ? `${seconds(clip.media.duration)} · ${clip.media.width} × ${clip.media.height} · resolution will be normalized at export`
                    : "Generate manually in Flow, download MP4, and upload it here."}
                </p>
                <p className="hint">
                  This upload replaces segment {i + 1} only: source{" "}
                  {seconds(segment.start)}–{seconds(segment.end)}.
                </p>
              </div>
              <label className="button upload-button">
                <Film size={14} />
                {clip ? "Replace clip" : "Import Flow clip"}
                <input
                  aria-label={`Upload clip for segment ${i + 1}`}
                  disabled={busy || stale}
                  type="file"
                  accept=".mp4,.mov"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) run("import_clip", { segmentId: segment.id }, f);
                  }}
                />
              </label>
            </div>
            {clip && (
              <div className="imported-preview">
                <video
                  key={clip.asset}
                  controls
                  playsInline
                  preload="metadata"
                  src={assetUrl(clip.asset)}
                />
                {version.assemblyTiming === "EDITED_CLIPS" ? (
                  <p className="hint">
                    Assigned file: {clip.sourceName || clip.asset}.{" "}
                    {placement
                      ? `Export uses ${seconds(placement.trim)}–${seconds(placement.trim + placement.used)} of this file, at ${seconds(placement.start)}–${seconds(placement.end)} in the final video.${placement.hold > 0.035 ? ` Final frame holds for ${seconds(placement.hold)}.` : ""}`
                      : "Edited clip timing is enabled. Earlier clips use their uploaded lengths; the final clip fills the remaining soundtrack. Review the timing in Assemble & export."}
                  </p>
                ) : (
                  <p className="hint">
                    Assigned file: {clip.sourceName || clip.asset}. Export uses{" "}
                    {seconds(clip.trim + segment.overlap)}–
                    {seconds(
                      Math.min(
                        clip.media.duration,
                        clip.trim + segment.end - segment.start,
                      ),
                    )}{" "}
                    of this file. The player shows the full uploaded clip.
                  </p>
                )}
                {version.assemblyTiming !== "EDITED_CLIPS" &&
                  clip.media.duration - clip.trim <
                    segment.end - segment.start - 0.035 && (
                    <p className="notice">
                      This clip keeps its uploaded speed. Its final frame will
                      hold for{" "}
                      {seconds(
                        segment.end -
                          segment.start -
                          (clip.media.duration - clip.trim),
                      )}{" "}
                      to fill this segment and keep the selected soundtrack in
                      sync.
                    </p>
                  )}
                {version.assemblyTiming !== "EDITED_CLIPS" &&
                  clip.media.duration -
                    clip.trim -
                    (segment.end - segment.start) >
                    0.25 && (
                    <p className="notice">
                      Only{" "}
                      {seconds(segment.end - segment.start - segment.overlap)}{" "}
                      of this {seconds(clip.media.duration)} clip will appear in
                      the final video. Adjust the trim to choose which part, or
                      upload to the intended segment. Other segments keep their
                      assigned clips.
                    </p>
                  )}
                <label>
                  Trim from clip start (s)
                  <input
                    key={`${clip.asset}-${clip.trim}`}
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={clip.trim}
                    disabled={busy}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value !== clip.trim)
                        run("trim_clip", { segmentId: segment.id, value });
                    }}
                  />
                  <span className="hint">
                    Overlap of {seconds(segment.overlap)} is additionally
                    removed in assembly.
                  </span>
                </label>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
