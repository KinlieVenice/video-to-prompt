"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Plus,
  Upload,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import type { Analysis, Character, Version } from "../../lib/studio/types";
import { assetUrl, defaultVoice, TTS_MODELS } from "../../lib/studio/types";
import type { StudioAction } from "./Studio";

export function CharacterPanel({
  characters,
  analysis,
  version,
  updateVersion,
  run,
  busy,
}: {
  characters: Character[];
  analysis?: Analysis;
  version?: Version;
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<Character>();
  const [previewText, setPreviewText] = useState(
    "Kumusta! This is my voice. Ready na tayo.",
  );
  const saved = characters.find((c) => c.id === selected);
  useEffect(() => {
    if (saved) setDraft(structuredClone(saved));
  }, [saved]);
  const patch = (update: Partial<Character>) =>
    setDraft((c) => (c ? { ...c, ...update } : c));
  const voice = (update: Partial<Character["voice"]>) =>
    setDraft((c) => (c ? { ...c, voice: { ...c.voice, ...update } } : c));
  const create = () => {
    const c: Character = {
      id: crypto.randomUUID(),
      name: "",
      description: "",
      visualStyle: "",
      references: [],
      voice: defaultVoice(),
      updatedAt: new Date().toISOString(),
    };
    setSelected(c.id);
    setDraft(c);
  };
  const save = async () =>
    draft ? run("save_character", { value: draft }) : undefined;
  const voiceAction = async (action: string) => {
    if (await save())
      await run(action, { characterId: draft!.id, name: previewText });
  };
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">02 / RECAST THE SCENE</span>
            <h2>New cast. Same performance.</h2>
          </div>
          <button className="button primary" disabled={busy} onClick={create}>
            <Plus size={16} />
            New character
          </button>
        </div>
        <p className="muted">
          Reusable profiles hold appearance, image references and a saved voice.
          Use any character in any project.
        </p>
        {analysis && version && (
          <div className="mapping-list">
            {analysis.speakers.length ? (
              analysis.speakers.map((s) => (
                <div className="mapping" key={s.id}>
                  <div className="avatar">{s.name.slice(0, 1)}</div>
                  <div>
                    <strong>{s.name}</strong>
                    <p className="hint">{s.description}</p>
                  </div>
                  <ArrowRight size={18} />
                  <select
                    aria-label={`Replace ${s.name} with`}
                    value={version.mappings[s.id] || ""}
                    onChange={(e) => {
                      const mappings = { ...version.mappings };
                      if (e.target.value) mappings[s.id] = e.target.value;
                      else delete mappings[s.id];
                      updateVersion({ mappings });
                    }}
                  >
                    <option value="">Keep original / unassigned</option>
                    {characters.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            ) : (
              <p className="empty-note">
                Add original actors in Source & analysis to map them to
                characters.
              </p>
            )}
          </div>
        )}
      </section>
      <div className="library-grid">
        <section className="panel">
          <div className="panel-heading">
            <span className="eyebrow">CHARACTER LIBRARY</span>
            <span className="badge">{characters.length} saved</span>
          </div>
          <div className="character-list">
            {characters.map((c) => (
              <button
                className={`character-tile ${selected === c.id ? "selected" : ""}`}
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setDraft(structuredClone(c));
                }}
              >
                {c.references[0] ? (
                  <img alt="" src={assetUrl(c.references[0])} />
                ) : (
                  <div className="character-placeholder">
                    {c.name.slice(0, 1)}
                  </div>
                )}
                <div>
                  <strong>{c.name}</strong>
                  <span>{c.visualStyle || "No visual style set"}</span>
                  <small>
                    {c.voice.voiceId} · {c.voice.kind.toLowerCase()}
                  </small>
                </div>
              </button>
            ))}
          </div>
          {!characters.length && (
            <div className="empty-library">
              <div className="large-avatar">?</div>
              <h3>Your cast starts here.</h3>
              <p className="muted">
                Create a character once, then reuse its look and voice across
                reenactments.
              </p>
              <button className="button" onClick={create}>
                <Plus size={14} />
                Create character
              </button>
            </div>
          )}
        </section>
        {draft ? (
          <section className="panel stack">
            <div className="panel-heading">
              <span className="eyebrow">CHARACTER PROFILE</span>
              {saved && (
                <button
                  className="button small-button"
                  disabled={busy}
                  onClick={() => {
                    const copy = {
                      ...structuredClone(draft),
                      id: crypto.randomUUID(),
                      name: `${draft.name} copy`,
                    };
                    setSelected(copy.id);
                    setDraft(copy);
                  }}
                >
                  <Copy size={13} />
                  Duplicate profile
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Close character editor"
                onClick={() => {
                  setDraft(undefined);
                  setSelected(undefined);
                }}
              >
                <X size={17} />
              </button>
            </div>
            <label>
              Name
              <input
                value={draft.name}
                placeholder="Character name"
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            {saved && (
              <p className="hint">
                Profiles are shared. Appearance or reference changes require new
                clips in linked versions. Duplicate this profile to preserve an
                alternate cast.
              </p>
            )}
            <label>
              Character description
              <textarea
                value={draft.description}
                rows={3}
                placeholder="Appearance, proportions, distinctive details…"
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <label>
              Visual style
              <input
                value={draft.visualStyle}
                placeholder="Live action, claymation, illustrated, 3D…"
                onChange={(e) => patch({ visualStyle: e.target.value })}
              />
            </label>
            <div>
              <label>Reference images</label>
              <div className="reference-grid">
                {draft.references.map((asset, i) => (
                  <div className="reference-thumb" key={asset}>
                    <img
                      src={assetUrl(asset)}
                      alt={`${draft.name} reference ${i + 1}`}
                    />
                    <button
                      className="icon-button"
                      aria-label={`Remove reference ${i + 1}`}
                      onClick={() =>
                        patch({
                          references: draft.references.filter(
                            (a) => a !== asset,
                          ),
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <label className="button upload-button">
                <Upload size={14} />
                Upload reference
                <input
                  disabled={busy || !draft.name.trim()}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file && (await save()))
                      await run(
                        "upload_reference",
                        { characterId: draft.id },
                        file,
                      );
                  }}
                />
              </label>
              <p className="hint">
                PNG, JPG, WebP · 12 MB each. Save the profile before previewing
                its voice.
              </p>
            </div>
            <div className="divider" />
            <div className="panel-heading">
              <div>
                <span className="eyebrow">SAVED VOICE</span>
                <h3>A consistent voice for every line.</h3>
              </div>
              <Volume2 size={20} />
            </div>
            <div className="two-cols">
              <label>
                TTS provider
                <input readOnly value="Google Gemini" />
              </label>
              <label>
                TTS model
                <select
                  value={draft.voice.model}
                  onChange={(e) => voice({ model: e.target.value })}
                >
                  {TTS_MODELS.map((m) => (
                    <option value={m} key={m}>
                      {m.includes("lite")
                        ? "Flash-Lite TTS · lower cost"
                        : "Flash TTS · expressive"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="two-cols">
              <label>
                Voice type
                <select
                  value={draft.voice.kind}
                  onChange={(e) =>
                    voice({ kind: e.target.value as "PREBUILT" | "DESIGNED" })
                  }
                >
                  <option value="PREBUILT">Prebuilt</option>
                  <option value="DESIGNED">Designed voice</option>
                </select>
              </label>
              <label>
                Voice ID
                <input
                  value={draft.voice.voiceId}
                  placeholder="Kore or voice_…"
                  onChange={(e) => voice({ voiceId: e.target.value })}
                  list="prebuilt-voices"
                />
                <datalist id="prebuilt-voices">
                  <option value="Kore" />
                  <option value="Puck" />
                  <option value="Aoede" />
                  <option value="Charon" />
                  <option value="Fenrir" />
                </datalist>
              </label>
            </div>
            <div className="two-cols">
              <label>
                Language
                <select
                  value={draft.voice.language}
                  onChange={(e) =>
                    voice({
                      language: e.target
                        .value as Character["voice"]["language"],
                    })
                  }
                >
                  <option value="auto">
                    Auto · Filipino / English / Taglish
                  </option>
                  <option value="fil-PH">Filipino + code-switching</option>
                  <option value="en-US">English + code-switching</option>
                </select>
              </label>
              <label>
                Playback / assembly speed
                <input
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={draft.voice.speed}
                  onChange={(e) => voice({ speed: Number(e.target.value) })}
                />
              </label>
            </div>
            <label>
              Default delivery style
              <input
                value={draft.voice.style}
                placeholder="Warm, calm, expressive…"
                onChange={(e) => voice({ style: e.target.value })}
              />
            </label>
            {draft.voice.kind === "DESIGNED" && (
              <>
                <label>
                  Voice design description
                  <textarea
                    value={draft.voice.designPrompt}
                    rows={2}
                    placeholder="Describe vocal character, timbre, accent and baseline delivery…"
                    onChange={(e) => voice({ designPrompt: e.target.value })}
                  />
                </label>
                <button
                  className="button"
                  disabled={busy || !draft.name.trim()}
                  onClick={() => voiceAction("design_voice")}
                >
                  <WandSparkles size={15} />
                  Design & save voice · API charge
                </button>
                <span className="hint">
                  You can also paste a designed voice ID from Google AI Studio.
                </span>
              </>
            )}
            <label>
              Preview script
              <input
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
              />
            </label>
            <div className="inline wrap">
              <button
                className="button"
                disabled={busy || !draft.name.trim()}
                onClick={() => voiceAction("preview_voice")}
              >
                <Volume2 size={15} />
                Generate voice preview · API charge
              </button>
              {draft.voice.previewAsset && (
                <audio
                  src={assetUrl(draft.voice.previewAsset)}
                  controls
                  onLoadedMetadata={(e) => {
                    e.currentTarget.playbackRate = draft.voice.speed;
                  }}
                />
              )}
            </div>
            <button
              className="button primary"
              disabled={busy || !draft.name.trim()}
              onClick={save}
            >
              <Check size={15} />
              Save character
            </button>
          </section>
        ) : (
          <section className="panel editor-placeholder">
            <span className="eyebrow">A REUSABLE CAST</span>
            <h2>
              Designed once.
              <br />
              Ready for the next scene.
            </h2>
            <p className="muted">
              Select a profile to edit its look, reference images and voice.
              Character changes never rerun source analysis.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
