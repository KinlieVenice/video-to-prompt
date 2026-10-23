"use client";
import { Plus, Trash2 } from "lucide-react";
import type { MotionBeat, Shot } from "../../lib/studio/types";
import { assetUrl } from "../../lib/studio/types";
import { formatMotion, evidenceLabel } from "../../lib/studio/motion";

export function MotionTimelineEditor({
  shot,
  onChange,
  onReview,
  busy,
}: {
  shot: Shot;
  onChange: (patch: Partial<Shot>) => void;
  onReview: (start: number, end: number) => void;
  busy: boolean;
}) {
  const beats = shot.motionBeats || [];
  const change = (next: MotionBeat[]) =>
    onChange({ motionBeats: next, motion: formatMotion(next) });
  const edit = (id: string, patch: Partial<MotionBeat>) =>
    change(
      beats.map((b) =>
        b.id === id
          ? {
              ...b,
              reviewed: patch.reviewed ?? false,
              ...("start" in patch || "end" in patch || "onset" in patch
                ? { evidence: undefined }
                : {}),
              ...patch,
            }
          : b,
      ),
    );
  return (
    <div className="stack">
      <div className="panel-heading">
        <div>
          <h3>Action timing and key poses</h3>
          <p className="hint">
            An activity span describes sustained movement. Onset uncertainty is
            a separate before/after range, or unknown when an action is already
            underway. Review the evidence and source before verifying timing.
          </p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            const start = shot.start,
              end = Math.min(shot.end, start + 0.5);
            change([
              ...beats,
              {
                id: crypto.randomUUID(),
                start,
                end,
                action: "",
                phase: "ACTION",
                importance: "KEY",
                confidence: "LOW",
                evidenceTimes: [],
                anchorTime: start,
                reviewed: false,
                timingKind: "ACTIVITY",
              },
            ]);
          }}
        >
          <Plus size={14} />
          Add motion beat
        </button>
      </div>
      {shot.motionSampling && (
        <p className="hint">
          {shot.motionSampling.times.length} AI input samples · largest gap{" "}
          {shot.motionSampling.maxGap.toFixed(3)}s ·{" "}
          {shot.motionSampling.windows} analysis windows. Source frame rate
          limits timing resolution.
        </p>
      )}
      {beats.map((beat, i) => (
        <div className="edit-card stack" key={beat.id}>
          <div className="panel-heading">
            <strong>
              Beat {i + 1} · {beat.phase.toLowerCase()}
            </strong>
            <span className="badge">{evidenceLabel(beat)}</span>
            <button
              className="icon-button"
              aria-label={`Remove motion beat ${i + 1}`}
              onClick={() => change(beats.filter((b) => b.id !== beat.id))}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="two-cols">
            <label>
              Observed span start (source seconds)
              <input
                aria-label={`Earliest motion time ${i + 1}`}
                type="number"
                step="0.01"
                min={shot.start}
                max={shot.end}
                value={beat.start}
                onChange={(e) =>
                  edit(beat.id, {
                    start: Number(e.target.value),
                    reviewed: false,
                  })
                }
              />
            </label>
            <label>
              Observed span end (source seconds)
              <input
                aria-label={`Latest motion time ${i + 1}`}
                type="number"
                step="0.01"
                min={shot.start}
                max={shot.end}
                value={beat.end}
                onChange={(e) =>
                  edit(beat.id, {
                    end: Number(e.target.value),
                    reviewed: false,
                  })
                }
              />
            </label>
          </div>
          <label>
            Timing meaning
            <select
              aria-label={`Timing meaning ${i + 1}`}
              value={beat.timingKind || ""}
              onChange={(e) =>
                edit(beat.id, {
                  timingKind: e.target.value
                    ? (e.target.value as MotionBeat["timingKind"])
                    : undefined,
                })
              }
            >
              <option value="">Legacy range · refine or classify</option>
              <option value="ACTIVITY">Sustained activity span</option>
              <option value="TRANSITION">Observed state transition</option>
              <option value="OBSERVATION">Pose observation</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              aria-label={`Action already ongoing ${i + 1}`}
              type="checkbox"
              checked={Boolean(beat.continuing)}
              onChange={(e) =>
                edit(beat.id, {
                  continuing: e.target.checked,
                  ...(e.target.checked ? { onset: undefined } : {}),
                })
              }
            />
            Action already ongoing · do not restart it
          </label>
          <label className="checkbox">
            <input
              aria-label={`Onset known ${i + 1}`}
              type="checkbox"
              disabled={beat.continuing}
              checked={Boolean(beat.onset)}
              onChange={(e) =>
                edit(beat.id, {
                  onset: e.target.checked
                    ? {
                        start: beat.start,
                        end: Math.min(beat.end, beat.start + 0.5),
                      }
                    : undefined,
                })
              }
            />
            Before/after observations bracket the onset
          </label>
          {beat.onset ? (
            <div className="two-cols">
              <label>
                Onset earliest (source seconds)
                <input
                  aria-label={`Onset earliest ${i + 1}`}
                  type="number"
                  min={shot.start}
                  max={beat.end}
                  step="0.01"
                  value={beat.onset.start}
                  onChange={(e) =>
                    edit(beat.id, {
                      onset: { ...beat.onset!, start: Number(e.target.value) },
                    })
                  }
                />
              </label>
              <label>
                Onset latest (source seconds)
                <input
                  aria-label={`Onset latest ${i + 1}`}
                  type="number"
                  min={shot.start}
                  max={beat.end}
                  step="0.01"
                  value={beat.onset.end}
                  onChange={(e) =>
                    edit(beat.id, {
                      onset: { ...beat.onset!, end: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <p className="hint">
              Onset unknown. The span above does not establish when this action
              began.
            </p>
          )}
          <label>
            Observed action
            <textarea
              aria-label={`Motion action ${i + 1}`}
              rows={2}
              value={beat.action}
              onChange={(e) =>
                edit(beat.id, { action: e.target.value, reviewed: false })
              }
            />
          </label>
          <div className="two-cols">
            <label>
              State in before evidence
              <textarea
                rows={2}
                value={beat.stateBefore || ""}
                onChange={(e) => edit(beat.id, { stateBefore: e.target.value })}
              />
            </label>
            <label>
              State in after evidence
              <textarea
                rows={2}
                value={beat.stateAfter || ""}
                onChange={(e) => edit(beat.id, { stateAfter: e.target.value })}
              />
            </label>
          </div>
          <div className="two-cols">
            <label>
              Action phase
              <select
                value={beat.phase}
                onChange={(e) =>
                  edit(beat.id, {
                    phase: e.target.value as MotionBeat["phase"],
                  })
                }
              >
                {["SETUP", "ACTION", "REACTION", "RECOVERY", "HOLD"].map(
                  (p) => (
                    <option key={p} value={p}>
                      {p.toLowerCase()}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Key pose time (source seconds)
              <input
                type="number"
                step="0.01"
                min={beat.start}
                max={beat.end}
                value={beat.anchorTime}
                onChange={(e) =>
                  edit(beat.id, {
                    anchorTime: Number(e.target.value),
                    frameAsset: undefined,
                    reviewed: false,
                  })
                }
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(beat.settled)}
              onChange={(e) => edit(beat.id, { settled: e.target.checked })}
            />
            A settled/stabilized state is visible · required for recovery
          </label>
          {beat.timingNotes?.map((note) => (
            <p className="hint" key={note}>
              {note}
            </p>
          ))}
          {beat.evidence && (
            <div className="frame-pair">
              {(["before", "after"] as const).map((side) => (
                <a
                  key={side}
                  href={assetUrl(beat.evidence![side].asset)}
                  download
                  className="frame-slot"
                >
                  <img
                    src={assetUrl(beat.evidence![side].asset)}
                    alt={`${side} evidence for beat ${i + 1} at ${beat.evidence![side].time.toFixed(3)} seconds`}
                  />
                  <span>
                    {side.toUpperCase()} ·{" "}
                    {beat.evidence![side].time.toFixed(3)}s
                  </span>
                </a>
              ))}
            </div>
          )}
          <p className="hint">
            Observed frames:{" "}
            {beat.evidenceTimes.length
              ? beat.evidenceTimes.map((t) => `${t.toFixed(3)}s`).join(", ")
              : "Manual beat; verify against the source."}
          </p>
          <div className="inline wrap">
            <button
              className="button"
              onClick={() => onReview(beat.start, beat.end)}
            >
              Review in slow motion
            </button>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={beat.importance === "KEY"}
                onChange={(e) =>
                  edit(beat.id, {
                    importance: e.target.checked ? "KEY" : "NORMAL",
                  })
                }
              />
              Key moment reference
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={beat.reviewed}
                onChange={(e) => edit(beat.id, { reviewed: e.target.checked })}
              />
              Timing reviewed against source
            </label>
          </div>
          {beat.frameAsset && (
            <a className="fit" href={assetUrl(beat.frameAsset)} download>
              <img
                style={{ maxWidth: 200, maxHeight: 150, objectFit: "contain" }}
                src={assetUrl(beat.frameAsset)}
                alt={`Source pose at ${beat.anchorTime.toFixed(3)} seconds`}
              />
              <small>
                Source pose at {beat.anchorTime.toFixed(3)}s · original actor
              </small>
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
