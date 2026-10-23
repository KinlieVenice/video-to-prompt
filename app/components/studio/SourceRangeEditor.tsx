"use client";
import { useState } from "react";
import type { Analysis, Version } from "../../lib/studio/types";
import { seconds } from "../../lib/studio/types";
import { reenactmentRange } from "../../lib/studio/range";
import type { StudioAction } from "./Studio";

export function SourceRangeEditor({
  analysis,
  version,
  run,
  busy,
  onPreview,
}: {
  analysis: Analysis;
  version: Version;
  run: StudioAction;
  busy: boolean;
  onPreview: (start: number, end: number) => void;
}) {
  const saved = reenactmentRange(analysis, version);
  const [range, setRange] = useState(saved);
  let error = "";
  try {
    reenactmentRange(analysis, { sourceRange: range });
  } catch (e) {
    error = (e as Error).message;
  }
  const changed = range.start !== saved.start || range.end !== saved.end;
  return (
    <section className="panel stack">
      <div>
        <span className="eyebrow">REENACTMENT RANGE</span>
        <h3>Choose how much to reenact.</h3>
      </div>
      <p className="muted">
        For only the first 10 seconds, set start to 0 and end to 10. Plans and
        exports use this interval, including the matching original soundtrack.
        Full source analysis stays reusable across versions.
      </p>
      <div className="two-cols">
        <label>
          Reenact from (source seconds)
          <input
            type="number"
            min="0"
            max={analysis.media.duration}
            step="0.001"
            value={range.start}
            onChange={(e) =>
              setRange({ ...range, start: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Reenact until (source seconds)
          <input
            type="number"
            min="0"
            max={analysis.media.duration}
            step="0.001"
            value={range.end}
            onChange={(e) =>
              setRange({ ...range, end: Number(e.target.value) })
            }
          />
        </label>
      </div>
      {error ? (
        <p className="notice" role="status">
          {error}
        </p>
      ) : (
        <span className="hint">
          {seconds(range.end - range.start)} final video · source{" "}
          {seconds(range.start)}–{seconds(range.end)}
          {changed ? " · not applied yet" : " · saved for this version"}
        </span>
      )}
      <div className="inline wrap">
        <button
          className="button primary"
          disabled={busy || !!error || !changed}
          onClick={() =>
            run("save_version", { value: { ...version, sourceRange: range } })
          }
        >
          Apply range
        </button>
        <button
          className="button"
          disabled={busy || !!error}
          onClick={() => onPreview(range.start, range.end)}
        >
          Preview range
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={() => setRange({ start: 0, end: analysis.media.duration })}
        >
          Use full video
        </button>
      </div>
      <span className="hint">
        Changing the range requires replanning segments. Replanning clears this
        version’s frame and clip assignments; saved files remain on disk.
      </span>
    </section>
  );
}
