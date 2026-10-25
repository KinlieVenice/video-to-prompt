"use client";
import { useState } from "react";
import {
  contentIntervals,
  type ContentPlan,
  type NicheVideo,
} from "../../lib/studio/niche";

export function NichePlanReview({
  video,
  locked,
  save,
  start,
}: {
  video: NicheVideo;
  locked: boolean;
  save: (plan: ContentPlan) => Promise<boolean>;
  start: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<ContentPlan>(() =>
    structuredClone(video.plan!),
  );
  const [saved, setSaved] = useState(JSON.stringify(video.plan));
  const dirty = JSON.stringify(plan) !== saved;
  const intervals = contentIntervals(
    video.nicheSnapshot.duration,
    video.nicheSnapshot.defaults.maxDuration,
  );
  const speech = ["CHARACTER_TTS", "FLOW_CLIPS"].includes(
    video.nicheSnapshot.audioMode,
  );
  const patch = (
    i: number,
    field: keyof ContentPlan["scenes"][number],
    value: string,
  ) =>
    setPlan((current) => ({
      ...current,
      scenes: current.scenes.map((scene, index) =>
        index === i ? { ...scene, [field]: value } : scene,
      ),
    }));
  const tooLong =
    speech &&
    plan.scenes.some(
      (scene, i) =>
        scene.narration.trim().split(/\s+/).filter(Boolean).length >
        Math.floor((intervals[i].end - intervals[i].start) * 2),
    );
  return (
    <div className="edit-card stack" aria-label="Script review">
      <h4>Review script before media generation</h4>
      <p className="hint">
        No audio, images or Flow clips have started for this storyboard. Review
        facts and quotations, then save any edits and approve generation. Script
        planning uses your configured text provider.
      </p>
      <label>
        Script title
        <input
          value={plan.title}
          maxLength={200}
          disabled={locked}
          onChange={(e) => setPlan({ ...plan, title: e.target.value })}
        />
      </label>
      <label>
        Opening hook
        <textarea
          value={plan.hook}
          maxLength={1000}
          disabled={locked}
          onChange={(e) => setPlan({ ...plan, hook: e.target.value })}
        />
      </label>
      <p className="hint">
        For spoken videos, also edit the opening narration below; hook notes are
        not spoken separately.
      </p>
      {plan.scenes.map((scene, i) => (
        <div className="stack" key={i}>
          <strong>
            Scene {i + 1} · {(intervals[i].end - intervals[i].start).toFixed(2)}
            s
          </strong>
          {speech && (
            <label>
              Narration · scene {i + 1}
              <textarea
                rows={3}
                value={scene.narration}
                maxLength={1500}
                disabled={locked}
                onChange={(e) => patch(i, "narration", e.target.value)}
              />
            </label>
          )}
          <p className="hint">
            {speech
              ? `${scene.narration.trim().split(/\s+/).filter(Boolean).length} / ${Math.floor((intervals[i].end - intervals[i].start) * 2)} spoken words. `
              : "Visual-only storyboard; narration comes from your selected audio mode. "}
            Edit composition and frame descriptions together if changing the
            story.
          </p>
          <details>
            <summary>Scene {i + 1} visual and performance details</summary>
            {(
              [
                "description",
                "firstFrame",
                "lastFrame",
                "camera",
                "lighting",
                "motion",
                "emotion",
              ] as const
            ).map((field) => (
              <label key={field}>
                {
                  {
                    description: "Composition",
                    firstFrame: "First frame",
                    lastFrame: "Last frame",
                    camera: "Camera",
                    lighting: "Lighting",
                    motion: "Motion",
                    emotion: "Delivery",
                  }[field]
                }{" "}
                · scene {i + 1}
                <textarea
                  value={scene[field]}
                  maxLength={
                    field === "emotion"
                      ? 300
                      : ["camera", "lighting"].includes(field)
                        ? 1000
                        : 3000
                  }
                  disabled={locked}
                  onChange={(e) => patch(i, field, e.target.value)}
                />
              </label>
            ))}
          </details>
        </div>
      ))}
      {tooLong && (
        <p role="alert" className="notice">
          Some narration exceeds its scene's word budget. Shorten it before
          saving.
        </p>
      )}
      <div className="button-row">
        <button
          className="button"
          disabled={locked || !dirty || tooLong}
          onClick={async () => {
            if (await save(plan)) setSaved(JSON.stringify(plan));
          }}
        >
          Save script edits
        </button>
        <button
          className="button primary"
          disabled={locked || dirty || tooLong}
          onClick={start}
        >
          Approve & generate video
        </button>
      </div>
      {dirty && (
        <p className="hint">Save your script edits before approving.</p>
      )}
    </div>
  );
}
