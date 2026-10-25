"use client";
import { useState } from "react";
import {
  hookPresets,
  nicheStorySchema,
  type NicheStory,
} from "../../lib/studio/niche-story";

export function NicheStoryFields({
  value,
  onChange,
}: {
  value?: NicheStory;
  onChange: (value: NicheStory) => void;
}) {
  const story = { ...nicheStorySchema.parse({}), ...value };
  const [fileError, setFileError] = useState("");
  const patch = (next: Partial<NicheStory>) => onChange({ ...story, ...next });
  const hook = hookPresets.find((p) => p.id === story.hookStyle)!;
  return (
    <div className="stack">
      <label>
        Opening hook (optional)
        <select
          value={story.hookStyle}
          onChange={(e) =>
            patch({ hookStyle: e.target.value as NicheStory["hookStyle"] })
          }
        >
          {hookPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {hook.guidance} Example: {hook.example}
      </p>
      {story.hookStyle === "CUSTOM" && (
        <label>
          Custom hook (optional)
          <textarea
            rows={3}
            maxLength={1000}
            value={story.customHook}
            onChange={(e) => patch({ customHook: e.target.value })}
            placeholder="An opening line, reusable template or instructions. The planner adapts it to the topic and language."
          />
        </label>
      )}
      <details>
        <summary>Hook research and examples</summary>
        <p className="hint">
          These reusable formats are based on platform guidance, with original
          examples. They are starting points to test, rather than guaranteed
          viral formulas.
        </p>
        <p>
          <a
            href="https://ads.tiktok.com/business/creativecenter/quicktok/online/creative_tips_travel/pc/en"
            target="_blank"
            rel="noreferrer"
          >
            TikTok: question, interest, benefit and list hooks
          </a>{" "}
          ·{" "}
          <a
            href="https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads"
            target="_blank"
            rel="noreferrer"
          >
            TikTok: hook, body and close
          </a>{" "}
          ·{" "}
          <a
            href="https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/"
            target="_blank"
            rel="noreferrer"
          >
            YouTube: immediate intrigue and payoff
          </a>
        </p>
      </details>
      <details>
        <summary>Optional scripts, sources and storytelling</summary>
        <div className="stack">
          <p className="hint">
            Works with any niche. Leave every field blank to use your
            description and topic. Reference videos are also optional.
          </p>
          <label>
            Sample scripts (optional)
            <textarea
              rows={7}
              maxLength={24000}
              value={story.sampleScripts}
              onChange={(e) => patch({ sampleScripts: e.target.value })}
              placeholder="Paste scripts that demonstrate the tone, hook, pacing or ending you like. A main reference video takes priority for format when uploaded."
            />
          </label>
          <label className="button upload-button">
            Import sample script (.txt / .md)
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              aria-label="Import sample script"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setFileError("");
                try {
                  if (!/\.(txt|md)$/i.test(file.name) || file.size > 256 * 1024)
                    throw new Error(
                      "Choose a UTF-8 .txt or .md script up to 256 KB.",
                    );
                  const text = (await file.text())
                    .replace(/^\uFEFF/, "")
                    .trim();
                  if (
                    !text ||
                    text.includes("\u0000") ||
                    text.includes("\uFFFD")
                  )
                    throw new Error("Choose a nonempty UTF-8 text script.");
                  const combined = [
                    story.sampleScripts,
                    `--- ${file.name} ---\n${text}`,
                  ]
                    .filter(Boolean)
                    .join("\n\n");
                  if (combined.length > 24000)
                    throw new Error(
                      "Sample scripts must total at most 24,000 characters. Shorten or replace the existing text first.",
                    );
                  patch({ sampleScripts: combined });
                } catch (error) {
                  setFileError(
                    error instanceof Error
                      ? error.message
                      : "Could not read this script.",
                  );
                }
              }}
            />
          </label>
          {fileError && (
            <p role="alert" className="notice">
              {fileError}
            </p>
          )}
          <p className="hint">
            Imported text appears above for editing. Save the niche to keep it.
            Importing a script makes no AI request.
          </p>
          <label>
            What to learn from examples (optional)
            <textarea
              rows={3}
              maxLength={3000}
              value={story.referenceGuidance}
              onChange={(e) => patch({ referenceGuidance: e.target.value })}
              placeholder="For example: gentle delivery, a curious opening, short sentences and a reassuring ending. Applies to sample scripts and reference videos."
            />
          </label>
          <label>
            Story structure (optional)
            <textarea
              rows={3}
              maxLength={3000}
              value={story.structure}
              onChange={(e) => patch({ structure: e.target.value })}
              placeholder="For example: hook → story → reflection → comfort; or problem → demonstration → result."
            />
          </label>
          <label>
            Ending guidance (optional)
            <textarea
              rows={3}
              maxLength={3000}
              value={story.endingGuidance}
              onChange={(e) => patch({ endingGuidance: e.target.value })}
              placeholder="For example: finish with comfort, a practical takeaway, a reveal or a question."
            />
          </label>
          <label>
            Source reference (optional)
            <input
              maxLength={1000}
              value={story.sourceReference}
              onChange={(e) => patch({ sourceReference: e.target.value })}
              placeholder="Source title, citation, passage, edition or URL"
            />
          </label>
          <label>
            Source material (optional)
            <textarea
              rows={6}
              maxLength={12000}
              value={story.sourceMaterial}
              onChange={(e) => patch({ sourceMaterial: e.target.value })}
              placeholder="Facts, notes, product details, a passage or story material to base new scripts on. Keep style examples in Sample scripts above."
            />
          </label>
          <p className="hint">
            Source URLs are labels; this workflow does not fetch or verify them.
            Paste the relevant material here. Saved sources apply to future
            topics; include topic-specific details in the Topic field.
          </p>
        </div>
      </details>
      <label className="check">
        <input
          type="checkbox"
          checked={story.reviewBeforeGeneration}
          onChange={(e) => patch({ reviewBeforeGeneration: e.target.checked })}
        />
        Review script before generating media (optional)
      </label>
      <p className="hint">
        When enabled, Create video writes a script for you to edit and approve.
        Audio, image and Flow generation wait for approval. Leave unchecked for
        automatic assembly.
      </p>
    </div>
  );
}
