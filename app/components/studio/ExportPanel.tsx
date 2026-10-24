"use client";
import { Download, Film, Play } from "lucide-react";
import type { Analysis, Version } from "../../lib/studio/types";
import { assetUrl, seconds } from "../../lib/studio/types";
import type { StudioAction } from "./Studio";
import { reenactmentRange } from "../../lib/studio/range";
import { assemblyTimeline } from "../../lib/studio/assembly";

export function ExportPanel({
  analysis,
  version,
  updateVersion,
  run,
  busy,
}: {
  analysis: Analysis;
  version: Version;
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  busy: boolean;
}) {
  const range = reenactmentRange(analysis, version);
  const imported = version.segments.filter((s) => version.clips[s.id]).length;
  let timeline: ReturnType<typeof assemblyTimeline> = [];
  let timingError = "";
  if (version.segments.length && imported === version.segments.length) {
    try {
      timeline = assemblyTimeline(analysis, version);
    } catch (error) {
      timingError =
        error instanceof Error ? error.message : "Review clip timing.";
    }
  }
  const ready =
    !timingError &&
    version.segments.length > 0 &&
    imported === version.segments.length &&
    version.planRevision === analysis.revision;
  return (
    <div className="stack">
      <section className="panel stack">
        <span className="eyebrow">05 / PUT IT ALL TOGETHER</span>
        <h2>The final cut, on your machine.</h2>
        <p className="muted">
          FFmpeg validates imported clips, removes generation padding and
          overlap, normalizes resolution, and restores the selected audio on the
          source timeline. Choose whether video cuts follow the source or your
          edited clip lengths.
        </p>
        <div className="stat-grid">
          <div>
            <strong>
              {imported}/{version.segments.length}
            </strong>
            <span>clips imported</span>
          </div>
          <div>
            <strong>{seconds(range.end - range.start)}</strong>
            <span>
              selected source {seconds(range.start)}–{seconds(range.end)}
            </span>
          </div>
          <div>
            <strong>{version.audioMode.replace("CHARACTER_", "")}</strong>
            <span>audio mode</span>
          </div>
        </div>
        <label>
          Assembly timing
          <select
            aria-label="Assembly timing"
            value={version.assemblyTiming || "SOURCE"}
            onChange={(e) =>
              updateVersion({
                assemblyTiming: e.target.value as Version["assemblyTiming"],
              })
            }
          >
            <option value="SOURCE">Original segment timing</option>
            <option value="EDITED_CLIPS">
              Edited clip lengths · final clip fills remaining time
            </option>
          </select>
        </label>
        <p className="hint">
          {version.assemblyTiming === "EDITED_CLIPS"
            ? "Earlier clips play at their uploaded lengths after trim and overlap, without a hold between clips. The final clip fills the time left in the selected soundtrack: if 7 seconds remain, 7 seconds of a 17-second upload are used. The soundtrack is not sped up or shifted. A final clip that is too short holds its last frame."
            : "Each clip stays in its original source slot. Short clips hold their final frame to fill that slot; longer clips are trimmed to fit."}
        </p>
        {timingError && (
          <p className="notice" role="alert">
            {timingError}
          </p>
        )}
        {version.segments.length > 0 && (
          <details>
            <summary>Clips used in this export</summary>
            <div className="stack">
              {version.segments.map((segment, i) => {
                const clip = version.clips[segment.id];
                const placement = timeline[i];
                return (
                  <div key={segment.id}>
                    <strong>
                      Segment {i + 1} · source {seconds(segment.start)}–
                      {seconds(segment.end)}
                    </strong>
                    <p className="hint">
                      {clip
                        ? placement
                          ? `${clip.sourceName || clip.asset} · use ${seconds(placement.trim)}–${seconds(placement.trim + placement.used)} from uploaded clip · final video ${seconds(placement.start)}–${seconds(placement.end)}${placement.hold > 0.035 ? ` · hold final frame ${seconds(placement.hold)}` : ""}`
                          : `${clip.sourceName || clip.asset} · ${seconds(clip.media.duration)} uploaded; review timing above`
                        : "No clip assigned"}
                    </p>
                  </div>
                );
              })}
            </div>
          </details>
        )}
        <div className="two-cols">
          <label>
            Output aspect ratio
            <select
              value={version.aspect}
              onChange={(e) =>
                updateVersion({ aspect: e.target.value as Version["aspect"] })
              }
            >
              <option value="16:9">16:9 · 1280 × 720</option>
              <option value="9:16">9:16 · 720 × 1280</option>
            </select>
          </label>
          <label>
            Global audio sync (seconds)
            <input
              type="number"
              step="0.01"
              value={version.audioOffset}
              onChange={(e) =>
                updateVersion({ audioOffset: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={version.subtitles}
            onChange={(e) => updateVersion({ subtitles: e.target.checked })}
          />
          Include verbatim subtitles as an optional MP4 subtitle track
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={version.disclosure}
            onChange={(e) => updateVersion({ disclosure: e.target.checked })}
          />
          Add a visible “AI reenactment” disclosure
        </label>
        <p className="notice">
          Mouth movements are generated externally and may not match the final
          audio. Check dialogue against the preview and adjust global sync, line
          timing or clip trims before your final export.
        </p>
        <div className="inline wrap">
          <button
            className="button primary"
            disabled={busy || !ready}
            onClick={() => run("assemble")}
          >
            <Film size={16} />
            Assemble final MP4
          </button>
          <span className="hint">
            Local processing · no generation API charge · H.264 / AAC · 30 fps
          </span>
        </div>
        {!ready && (
          <p className="hint">
            Plan current segments and import every generated clip in Flow
            workspace to enable export.
          </p>
        )}
      </section>
      {version.exportAsset ? (
        <section className="panel stack">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">FINAL PREVIEW</span>
              <h3>Watch. Adjust. Export.</h3>
            </div>
            <a
              className="button primary"
              href={assetUrl(version.exportAsset)}
              download="reenactment.mp4"
            >
              <Download size={15} />
              Download MP4
            </a>
          </div>
          <video
            key={version.exportAsset}
            className="final-preview"
            controls
            playsInline
            src={assetUrl(version.exportAsset)}
          />
          <p className="hint">
            Enable the subtitle track in your video player if captions were
            included. Edit sync above and assemble again to apply adjustments.
          </p>
        </section>
      ) : (
        <section className="panel empty-workspace">
          <Play size={36} />
          <h3>Your assembled video will appear here.</h3>
          <p className="muted">
            Source timing stays intact wherever the generated clips allow it.
          </p>
        </section>
      )}
    </div>
  );
}
