"use client";
import { Download, Film, Play } from "lucide-react";
import type { Analysis, Version } from "../../lib/studio/types";
import { assetUrl, seconds } from "../../lib/studio/types";
import type { StudioAction } from "./Studio";

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
  const imported = version.segments.filter((s) => version.clips[s.id]).length;
  const ready =
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
          source timeline.
        </p>
        <div className="stat-grid">
          <div>
            <strong>
              {imported}/{version.segments.length}
            </strong>
            <span>clips imported</span>
          </div>
          <div>
            <strong>{seconds(analysis.media.duration)}</strong>
            <span>source duration</span>
          </div>
          <div>
            <strong>{version.audioMode.replace("CHARACTER_", "")}</strong>
            <span>audio mode</span>
          </div>
        </div>
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
