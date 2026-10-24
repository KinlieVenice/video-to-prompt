"use client";
import { useEffect, useRef, useState } from "react";
import type { Niche, NicheVideo } from "../../lib/studio/niche";
import type { Analysis, Character } from "../../lib/studio/types";
import { assetUrl } from "../../lib/studio/types";
import {
  guidedDefaultsSchema,
  type GuidedDefaults,
  type StudioRun,
} from "../../lib/studio/guided";
import type { RouterConnection } from "../../lib/studio/connection";
import { estimateNicheCredits } from "../../lib/studio/niche";

type Library = {
  niches: Niche[];
  videos: NicheVideo[];
  references: Analysis[];
  defaults: GuidedDefaults;
  nicheDefaults?: { duration: number; language: string; artStyle: string };
};
export function NicheStudio({
  characters,
  connection,
  onRunning,
  onCharacters,
  reload,
}: {
  characters: Character[];
  connection: RouterConnection;
  onRunning: (value: boolean) => void;
  onCharacters: () => void;
  reload: () => Promise<void>;
}) {
  const [library, setLibrary] = useState<Library>({
    niches: [],
    videos: [],
    references: [],
    defaults: guidedDefaultsSchema.parse({}),
  });
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Niche>();
  const [creditEdited, setCreditEdited] = useState(false);
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [automatic, setAutomatic] = useState<StudioRun>();
  const [savedRuns, setSavedRuns] = useState<Record<string, StudioRun>>({});
  const [video, setVideo] = useState<NicheVideo>();
  const [loop, setLoop] = useState(true);
  const [resumeCredits, setResumeCredits] = useState<number>();
  const pending = useRef(false);
  const niche = library.niches.find((n) => n.id === selected);
  const running = automatic?.state === "RUNNING";
  async function refresh() {
    const response = await fetch("/api/studio/niches", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open niches.");
    setLibrary(data);
    setSelected((current) =>
      data.niches.some(
        (n: Niche) =>
          n.id === (current || localStorage.getItem("studio:niche:selected")),
      )
        ? current || localStorage.getItem("studio:niche:selected")!
        : data.niches[0]?.id || "",
    );
    return data as Library;
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const cached = sessionStorage.getItem("studio:niche-draft");
    if (cached) {
      try {
        setDraft(JSON.parse(cached));
        setCreditEdited(true);
        setEditing(true);
      } catch {
        /* Start a fresh editor if local draft is invalid. */
      }
    }
  }, []);
  useEffect(() => {
    if (editing && draft)
      sessionStorage.setItem("studio:niche-draft", JSON.stringify(draft));
  }, [editing, draft]);
  useEffect(() => {
    if (selected) localStorage.setItem("studio:niche:selected", selected);
  }, [selected]);
  useEffect(() => {
    onRunning(Boolean(running || busy));
    return () => onRunning(false);
  }, [running, busy, onRunning]);
  useEffect(() => {
    let alive = true;
    const latest = library.videos
      .filter((v) => v.nicheId === selected && v.runId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) {
      setVideo(undefined);
      setAutomatic(undefined);
      return;
    }
    setVideo(latest);
    void fetch("/api/studio/runs", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (alive) {
          setSavedRuns(
            Object.fromEntries(
              (data.runs || []).map((r: StudioRun) => [r.id, r]),
            ),
          );
          setAutomatic(
            data.runs?.find((r: StudioRun) => r.id === latest.runId),
          );
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [selected, library.videos]);
  const runRequest = async (
    action: string,
    payload: Record<string, unknown> = {},
  ) => {
    const response = await fetch("/api/studio/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...payload,
        connection: { ...connection, imagesEnabled: true, ttsEnabled: true },
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Video generation failed.");
    return result.run as StudioRun;
  };
  useEffect(() => {
    if (!running || !loop || !automatic) return;
    const timer = setTimeout(
      async () => {
        if (pending.current) return;
        pending.current = true;
        try {
          const result = await runRequest("advance", { runId: automatic.id });
          setAutomatic(result);
          setSavedRuns((current) => ({ ...current, [result.id]: result }));
          if (result.state === "COMPLETE") await reload();
        } catch (e) {
          setLoop(false);
          setError(
            e instanceof Error
              ? e.message
              : "Connection interrupted; reload to restore progress.",
          );
        } finally {
          pending.current = false;
        }
      },
      automatic.stage === "FLOW" ? 4000 : 150,
    );
    return () => clearTimeout(timer);
    // One persisted operation per response; no credentials are stored in templates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automatic?.id, automatic?.updatedAt, automatic?.state, loop]);
  async function send(payload: Record<string, unknown>, file?: File) {
    const form = new FormData();
    form.set("payload", JSON.stringify({ ...payload, connection }));
    if (file) form.set("file", file);
    const response = await fetch("/api/studio/niches", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Niche operation failed.");
    return data;
  }
  async function action(
    label: string,
    payload: Record<string, unknown>,
    file?: File,
  ) {
    setBusy(label);
    setError("");
    try {
      const data = await send(payload, file);
      if (data.niche) {
        setSelected(data.niche.id);
        setDraft(data.niche);
      }
      if (data.run) {
        setAutomatic(data.run);
        setVideo(data.video);
        setLoop(true);
      }
      await refresh();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Niche operation failed.");
      await refresh().catch(() => undefined);
      return undefined;
    } finally {
      setBusy("");
    }
  }
  function create() {
    const defaults = library.defaults;
    const duration = library.nicheDefaults?.duration || 30;
    const creditEstimate = estimateNicheCredits({ duration, defaults });
    setCreditEdited(false);
    setDraft({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      artStyle: library.nicheDefaults?.artStyle || "",
      duration,
      language: library.nicheDefaults?.language || "English",
      characterId: "",
      defaults: structuredClone(defaults),
      audioMode:
        defaults.audioMode === "ORIGINAL"
          ? "CHARACTER_TTS"
          : defaults.audioMode,
      referenceIds: [],
      maxCredits: creditEstimate,
      updatedAt: new Date().toISOString(),
    });
    setEditing(true);
  }
  const patch = (value: Partial<Niche>) =>
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...value };
      if (
        !creditEdited &&
        value.maxCredits === undefined &&
        Number.isFinite(next.duration) &&
        next.duration >= 4 &&
        next.duration <= 180
      )
        next.maxCredits = estimateNicheCredits(next);
      return next;
    });
  const options = (value: Partial<GuidedDefaults>) =>
    draft && patch({ defaults: { ...draft.defaults, ...value } });
  const locked = Boolean(busy) || Boolean(running);
  const save = async () => {
    if (!draft) return;
    const result = await action("Saving niche…", {
      action: "save",
      value: draft,
    });
    if (result) {
      setEditing(false);
      sessionStorage.removeItem("studio:niche-draft");
    }
  };
  const generate = async (existing?: NicheVideo) => {
    if (!niche) return;
    if (existing) {
      await action("Starting saved storyboard…", {
        action: "start_video",
        videoId: existing.id,
      });
      return;
    }
    const key = `studio:niche-request:${niche.id}:${niche.updatedAt}:${topic.trim()}`;
    const requestId = localStorage.getItem(key) || crypto.randomUUID();
    localStorage.setItem(key, requestId);
    const result = await action("Writing script and planning scenes…", {
      action: "create_video",
      nicheId: niche.id,
      topic,
      requestId,
    });
    if (result) localStorage.removeItem(key);
  };
  const control = async (mode: "pause" | "resume") => {
    if (!automatic) return;
    setLoop(false);
    setBusy("Updating generation…");
    setError("");
    try {
      setAutomatic(
        await runRequest(mode, {
          runId: automatic.id,
          maxCredits: resumeCredits ?? automatic.maxCredits,
        }),
      );
      setLoop(mode === "resume");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update generation.");
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="stack" aria-label="Niche generator">
      <div className="panel stack">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">REUSABLE CONTENT WORKFLOWS</span>
            <h2>Your niches. One topic at a time.</h2>
          </div>
          <button className="button primary" disabled={locked} onClick={create}>
            Create niche
          </button>
        </div>
        <p className="muted">
          Save your format, reference videos, character, voice and settings
          once. Each topic becomes a new script, storyboard, generated clips and
          assembled MP4.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {busy && <p role="status">{busy}</p>}
        {!library.niches.length && !editing && (
          <p>No niches yet. Create your first reusable video workflow.</p>
        )}
        <div className="character-grid">
          {library.niches.map((n) => (
            <button
              key={n.id}
              className="character-tile"
              disabled={locked}
              onClick={() => {
                setSelected(n.id);
                setEditing(false);
                setTopic("");
              }}
            >
              <strong>{n.name}</strong>
              <span>
                {n.duration}s · {n.defaults.aspect} · {n.language}
              </span>
            </button>
          ))}
        </div>
      </div>
      {editing && draft ? (
        <div className="panel stack">
          <h3>
            {library.niches.some((n) => n.id === draft.id)
              ? "Edit niche"
              : "Create a niche"}
          </h3>
          <label>
            Niche name
            <input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label>
            Detailed niche description
            <textarea
              rows={6}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Audience, purpose, hook, story structure, visual style, pacing, tone, ending and what to avoid."
            />
          </label>
          <label>
            Art style
            <textarea
              rows={3}
              maxLength={3000}
              value={draft.artStyle || ""}
              onChange={(e) => patch({ artStyle: e.target.value })}
              placeholder="Example: watercolor storybook, cinematic 3D, anime, or flat 2D. Leave blank to use the character's saved visual style."
            />
          </label>
          <div className="two-cols">
            <label>
              Whole video length (seconds)
              <input
                type="number"
                min={4}
                max={180}
                step={1}
                value={draft.duration}
                onChange={(e) => patch({ duration: Number(e.target.value) })}
              />
            </label>
            <label>
              Script language
              <input
                value={draft.language}
                onChange={(e) => patch({ language: e.target.value })}
                placeholder="English, Filipino, Taglish…"
              />
            </label>
            <label>
              Character to use
              <select
                aria-label="Character to use"
                value={draft.characterId}
                onChange={(e) => patch({ characterId: e.target.value })}
              >
                <option value="">Choose a saved character</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Niche audio
              <select
                aria-label="Niche audio"
                value={draft.audioMode}
                onChange={(e) =>
                  patch({ audioMode: e.target.value as Niche["audioMode"] })
                }
              >
                <option value="CHARACTER_TTS">
                  Saved character voice · TTS
                </option>
                <option value="FLOW_CLIPS">Flow-generated dialogue</option>
                <option value="UPLOADED">Saved finished recording</option>
                <option value="SILENT">Silent</option>
              </select>
            </label>
          </div>
          <p className="hint">
            Saved character voice uses the provider, model and voice in
            Character library. Flow dialogue uses the video's generated voice.
            New topics have no original soundtrack to reuse.
          </p>
          <button
            className="button fit"
            disabled={locked}
            onClick={onCharacters}
          >
            Open character library
          </button>
          <details>
            <summary>Default generation settings</summary>
            <div className="stack two-cols">
              <label>
                Generation strategy
                <select
                  aria-label="Niche generation strategy"
                  value={draft.defaults.strategy}
                  onChange={(e) =>
                    options({
                      strategy: e.target.value as GuidedDefaults["strategy"],
                    })
                  }
                >
                  <option value="FIRST_LAST">First + last frame</option>
                  <option value="FRAMES">First frame</option>
                  <option value="INGREDIENTS">Ingredients / references</option>
                </select>
              </label>
              <label>
                Niche video model
                <select
                  value={draft.defaults.target}
                  onChange={(e) =>
                    options({
                      target: e.target.value as GuidedDefaults["target"],
                      maxDuration: 8,
                      resolution:
                        e.target.value === "VEO_LITE" ? "720p" : "360p",
                    })
                  }
                >
                  <option value="OMNI_FLASH">Omni 1.1 Flash</option>
                  <option value="VEO_LITE">Veo 3.1 Lite</option>
                </select>
              </label>
              <label>
                Niche resolution
                <select
                  value={draft.defaults.resolution}
                  onChange={(e) =>
                    options({ resolution: e.target.value as "360p" | "720p" })
                  }
                >
                  <option
                    value="360p"
                    disabled={draft.defaults.target === "VEO_LITE"}
                  >
                    360p
                  </option>
                  <option value="720p">720p</option>
                </select>
              </label>
              <label>
                Maximum seconds per clip
                <select
                  value={draft.defaults.maxDuration}
                  onChange={(e) =>
                    options({
                      maxDuration: Number(
                        e.target.value,
                      ) as GuidedDefaults["maxDuration"],
                    })
                  }
                >
                  {(draft.defaults.target === "VEO_LITE"
                    ? [8]
                    : [4, 6, 8, 10]
                  ).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Niche aspect
                <select
                  value={draft.defaults.aspect}
                  onChange={(e) =>
                    options({ aspect: e.target.value as "9:16" | "16:9" })
                  }
                >
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                </select>
              </label>
              <label>
                Niche expression
                <select
                  value={draft.defaults.expression}
                  onChange={(e) =>
                    options({
                      expression: e.target
                        .value as GuidedDefaults["expression"],
                    })
                  }
                >
                  <option value="EXPRESSIVE">Expressive</option>
                  <option value="SUBTLE">Subtle</option>
                  <option value="MATCH_SOURCE">Natural</option>
                </select>
              </label>
              <label>
                Niche image model
                <input
                  value={draft.defaults.imageModel}
                  onChange={(e) => options({ imageModel: e.target.value })}
                />
              </label>
              <label>
                Background direction
                <textarea
                  value={draft.defaults.backgroundPrompt}
                  onChange={(e) =>
                    options({
                      backgroundPrompt: e.target.value,
                      backgroundMode: e.target.value.trim() ? "NEW" : "SOURCE",
                    })
                  }
                  placeholder="Leave blank to let the storyboard choose suitable environments."
                />
              </label>
            </div>
          </details>
          <label>
            Total Flow credit limit per video
            <input
              type="number"
              min={0}
              max={10000}
              value={draft.maxCredits}
              onChange={(e) => {
                setCreditEdited(true);
                patch({ maxCredits: Number(e.target.value) });
              }}
            />
          </label>
          <p className="hint">
            New niches start from your environment defaults. This template keeps
            its own settings. Script, image and TTS usage through 9router are
            separate from this Flow credit limit. Add reference videos after
            saving.
          </p>
          <div className="inline wrap">
            <button
              className="button primary"
              disabled={
                locked ||
                !draft.characterId ||
                !draft.name.trim() ||
                draft.description.trim().length < 10
              }
              onClick={save}
            >
              Save niche
            </button>
            <button
              className="button"
              onClick={() => {
                setEditing(false);
                sessionStorage.removeItem("studio:niche-draft");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        niche && (
          <>
            <div className="panel stack">
              <div className="panel-heading">
                <h3>{niche.name}</h3>
                <button
                  className="button"
                  disabled={locked}
                  onClick={() => {
                    setCreditEdited(true);
                    setDraft(structuredClone(niche));
                    setEditing(true);
                  }}
                >
                  Edit niche
                </button>
              </div>
              <p>{niche.description}</p>
              <p className="hint">
                Art style: {niche.artStyle || "Saved character visual style"}
              </p>
              <p className="hint">
                {niche.duration}s ·{" "}
                {niche.defaults.target === "OMNI_FLASH"
                  ? "Omni 1.1 Flash"
                  : "Veo 3.1 Lite"}{" "}
                · {niche.defaults.resolution} · {niche.defaults.aspect} ·{" "}
                {characters.find((c) => c.id === niche.characterId)?.name} ·{" "}
                {niche.audioMode}
              </p>
              <h4>Reference videos</h4>
              <p className="hint">
                Upload and analyze once. Future topics reuse these saved
                observations for pacing and style. They do not copy the
                reference dialogue or soundtrack.
              </p>
              <label className="button upload-button">
                Upload & analyze reference
                <input
                  aria-label="Upload niche reference video"
                  disabled={locked || niche.referenceIds.length >= 6}
                  type="file"
                  accept=".mp4,.mov"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f)
                      void action(
                        "Scanning and analyzing reference…",
                        { action: "upload_reference", nicheId: niche.id },
                        f,
                      );
                  }}
                />
              </label>
              {niche.referenceIds.map((id) => {
                const reference = library.references.find((a) => a.id === id);
                return (
                  <div className="edit-card stack" key={id}>
                    <strong>{reference?.sourceName || id}</strong>
                    <span className="badge">
                      {reference?.status === "ANALYZED"
                        ? "Analysis saved for reuse"
                        : "Analysis pending"}
                    </span>
                    <details>
                      <summary>Reference observations</summary>
                      {reference?.shots.map((s) => (
                        <p key={s.id}>
                          {s.description} · {s.camera} · {s.motion}
                        </p>
                      ))}
                    </details>
                    {reference?.status !== "ANALYZED" && (
                      <button
                        className="button"
                        disabled={locked}
                        onClick={() =>
                          action("Analyzing reference…", {
                            action: "analyze_reference",
                            nicheId: niche.id,
                            analysisId: id,
                          })
                        }
                      >
                        Analyze saved reference
                      </button>
                    )}
                    <button
                      className="button"
                      disabled={locked}
                      onClick={() =>
                        action("Removing reference from this niche…", {
                          action: "save",
                          value: {
                            ...niche,
                            referenceIds: niche.referenceIds.filter(
                              (ref) => ref !== id,
                            ),
                          },
                        })
                      }
                    >
                      Remove reference
                    </button>
                  </div>
                );
              })}
              {niche.audioMode === "UPLOADED" && (
                <label className="button upload-button">
                  {niche.uploadedAudio
                    ? "Replace saved recording"
                    : "Upload saved recording"}
                  <input
                    aria-label="Upload niche recording"
                    disabled={locked}
                    type="file"
                    accept=".wav,.mp3,.m4a,.flac,.ogg"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f)
                        void action(
                          "Saving recording…",
                          { action: "upload_audio", nicheId: niche.id },
                          f,
                        );
                    }}
                  />
                </label>
              )}
            </div>
            <div className="panel stack">
              <h3>Create video</h3>
              <label>
                Topic
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={topic}
                  disabled={locked}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter only the subject of this video. The saved niche supplies everything else."
                />
              </label>
              <p className="hint">
                One original script, up to two reference-frame image requests
                per scene, selected narration, Flow clips and final MP4. Keep
                Recast and the connected Flow browser open. Limit:{" "}
                {niche.maxCredits} Flow credits.
              </p>
              <button
                className="button primary"
                disabled={
                  locked ||
                  !topic.trim() ||
                  niche.referenceIds.some(
                    (id) =>
                      library.references.find((a) => a.id === id)?.status !==
                      "ANALYZED",
                  )
                }
                onClick={() => generate()}
              >
                Create video · up to {niche.maxCredits} Flow credits
              </button>
            </div>
            {automatic && (
              <div className="panel stack" aria-live="polite">
                <h3>{video?.plan?.title || "Generating video"}</h3>
                <strong>{automatic.message}</strong>
                <p className="hint">
                  {automatic.stage} ·{" "}
                  {Object.values(automatic.reservations).reduce(
                    (a, b) => a + b,
                    0,
                  )}{" "}
                  / {automatic.maxCredits} Flow credits reserved
                </p>
                {automatic.error && (
                  <p className="notice" role="alert">
                    {automatic.error}
                  </p>
                )}
                {automatic.asset && automatic.state === "COMPLETE" ? (
                  <>
                    <video
                      className="final-preview"
                      key={automatic.asset}
                      controls
                      playsInline
                      src={assetUrl(automatic.asset)}
                    />
                    <a
                      className="button primary"
                      href={assetUrl(automatic.asset)}
                      download="niche-video.mp4"
                    >
                      Download niche video
                    </a>
                  </>
                ) : (
                  <>
                    {running ? (
                      <button
                        className="button"
                        disabled={Boolean(busy)}
                        onClick={() => control("pause")}
                      >
                        Pause generation
                      </button>
                    ) : (
                      <>
                        <label>
                          Resume credit limit
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            value={resumeCredits ?? automatic.maxCredits}
                            onChange={(e) =>
                              setResumeCredits(Number(e.target.value))
                            }
                          />
                        </label>
                        <button
                          className="button"
                          disabled={Boolean(busy)}
                          onClick={() => control("resume")}
                        >
                          Resume niche video
                        </button>
                      </>
                    )}
                    {!loop && running && (
                      <button className="button" onClick={() => setLoop(true)}>
                        Continue saved generation
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {library.videos
              .filter((v) => v.nicheId === niche.id)
              .map((v) => (
                <details className="panel" key={v.id}>
                  <summary>
                    {v.plan?.title || v.topic} ·{" "}
                    {savedRuns[v.runId || ""]?.state || v.state}
                  </summary>
                  <p>{v.topic}</p>
                  <p className="hint">
                    Art style used:{" "}
                    {v.nicheSnapshot.artStyle || "Character visual style"}
                  </p>
                  {savedRuns[v.runId || ""]?.state === "COMPLETE" &&
                    savedRuns[v.runId || ""].asset && (
                      <a
                        className="button"
                        href={assetUrl(savedRuns[v.runId || ""].asset!)}
                        download="niche-video.mp4"
                      >
                        Download this video
                      </a>
                    )}
                  {v.error && <p className="notice">{v.error}</p>}
                  {v.plan && (
                    <>
                      <p>{v.plan.hook}</p>
                      {v.plan.scenes.map((s, i) => (
                        <div key={i}>
                          <strong>Scene {i + 1}</strong>
                          <p>{s.narration}</p>
                          <p className="hint">{s.description}</p>
                        </div>
                      ))}
                    </>
                  )}
                  {v.state === "READY" && !v.runId && (
                    <button
                      className="button"
                      disabled={locked}
                      onClick={() => generate(v)}
                    >
                      Generate saved storyboard
                    </button>
                  )}
                </details>
              ))}
          </>
        )
      )}
    </section>
  );
}
