"use client";
import type { Version, VisualDirection } from "../../lib/studio/types";
import { visualDirection } from "../../lib/studio/visualDirection";
import type { StudioAction } from "./Studio";

export function VisualDirectionControls({
  version,
  updateVersion,
  run,
  busy,
}: {
  version: Version;
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  busy: boolean;
}) {
  const direction = visualDirection(version);
  const patch = (value: Partial<VisualDirection>) =>
    updateVersion({ visualDirection: { ...direction, ...value } });
  const needsBackground =
    direction.backgroundMode === "NEW" && !direction.backgroundPrompt;
  return (
    <div className="edit-card stack">
      <div>
        <span className="eyebrow">SCENE & PERFORMANCE</span>
        <h3>Choose the background and expression.</h3>
      </div>
      <div className="two-cols">
        <label>
          Background
          <select
            value={direction.backgroundMode}
            onChange={(e) =>
              patch({
                backgroundMode: e.target
                  .value as VisualDirection["backgroundMode"],
              })
            }
          >
            <option value="SOURCE">Match source background</option>
            <option value="NEW">Create a new background</option>
          </select>
        </label>
        <label>
          Character expressiveness
          <select
            value={direction.expression}
            onChange={(e) =>
              patch({
                expression: e.target.value as VisualDirection["expression"],
              })
            }
          >
            <option value="MATCH_SOURCE">Match source expressions</option>
            <option value="SUBTLE">Slightly more expressive</option>
            <option value="EXPRESSIVE">More expressive</option>
          </select>
        </label>
      </div>
      <label className="narrow-field">
        Generation aspect ratio
        <select
          value={version.aspect}
          onChange={(e) =>
            updateVersion({ aspect: e.target.value as Version["aspect"] })
          }
        >
          <option value="16:9">16:9 · landscape</option>
          <option value="9:16">9:16 · vertical</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={direction.completeScene ?? false}
          onChange={(e) => patch({ completeScene: e.target.checked })}
        />
        Complete cropped or padded areas
      </label>
      <p className="hint">
        Use the visible scene to continue cut-off objects, surfaces and scenery
        into artificial black bars or empty borders. Genuine dark backgrounds
        stay intact. Unseen details are plausible reconstructions. Turn this off
        to retain the original crop and borders.
      </p>
      {direction.backgroundMode === "NEW" ? (
        <label>
          New background description
          <textarea
            rows={3}
            maxLength={4000}
            value={version.visualDirection?.backgroundPrompt || ""}
            placeholder="A warm studio with a pastel wall, soft daylight and enough open floor space for the dance."
            onChange={(e) => patch({ backgroundPrompt: e.target.value })}
          />
          <span className="hint">
            Describe the setting, colors and lighting. Your chosen character,
            choreography, framing and action props stay the same.
          </span>
        </label>
      ) : (
        <p className="hint">
          Match the source environment, lighting and prop placement as closely
          as possible. Choose Match source expressions for the closest
          performance match.
        </p>
      )}
      {needsBackground && (
        <p className="notice" role="status">
          Describe the new background before saving or generating.
        </p>
      )}
      <p className="hint">
        Expression changes emphasize the existing emotion while preserving dance
        steps, hand positions, dialogue and source timing. Review generated
        frames and clips for differences from the source.
      </p>
      <div className="inline wrap">
        <button
          className="button fit"
          disabled={busy || needsBackground}
          onClick={() => run("save_version")}
        >
          Save scene & expression
        </button>
        <span className="hint">
          Saved per version. For an alternate look, duplicate the version first.
        </span>
      </div>
      <p className="hint">
        Saving a changed look clears generated frame and clip assignments for
        this version. Regenerate its reference frames and Flow clips using the
        same plan; original frames, source analysis and saved audio are reused.
      </p>
    </div>
  );
}
