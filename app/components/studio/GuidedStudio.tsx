"use client";
import { useEffect, useRef, useState } from "react";
import type { Analysis, Character, Version } from "../../lib/studio/types";
import { assetUrl } from "../../lib/studio/types";
import type { GuidedDefaults, StudioRun } from "../../lib/studio/guided";
import type { RouterConnection } from "../../lib/studio/connection";
import { ScenePlannerService } from "../../lib/studio/services/ScenePlannerService";
import type { StudioAction } from "./Studio";
import { CharacterPanel } from "./CharacterPanel";
import { AudioPanel } from "./AudioPanel";
import { VisualDirectionControls } from "./VisualDirectionControls";

type Step = "CAST" | "AUDIO" | "LOOK" | "READY";
export function GuidedStudio({
  projectId,
  analysis,
  version,
  characters,
  defaults,
  connection,
  updateVersion,
  run,
  busy,
  reload,
  onRunning,
  onAdvanced,
}: {
  projectId: string;
  analysis: Analysis;
  version: Version;
  characters: Character[];
  defaults: GuidedDefaults;
  connection: RouterConnection;
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  busy: boolean;
  reload: () => Promise<void>;
  onRunning: (value: boolean) => void;
  onAdvanced: () => void;
}) {
  const [step, setStep] = useState<Step>("CAST");
  const [automatic, setAutomatic] = useState<StudioRun>();
  const [loop, setLoop] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [imageModel, setImageModel] = useState(defaults.imageModel);
  const [maxCredits, setMaxCredits] = useState<number>();
  const loaded = useRef(false);
  const advancing = useRef(false);
  const storage = `studio:guided:${projectId}:${version.id}`;
  const castReady = Object.values(version.mappings).some((id) =>
    characters.some((c) => c.id === id),
  );
  let estimate = 0,
    generations = 0;
  try {
    const plan = ScenePlannerService.plan(analysis, version);
    estimate = plan.reduce((sum, s) => sum + s.credits, 0);
    generations = plan.length;
  } catch {
    /* Validation is shown when starting. */
  }
  const budget = maxCredits ?? estimate;
  const request = async (
    action: string,
    payload: Record<string, unknown> = {},
  ) => {
    const response = await fetch("/api/studio/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...payload,
        connection: { ...connection, imagesEnabled: true },
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Automatic run failed.");
    return result.run as StudioRun;
  };
  useEffect(() => {
    const saved = localStorage.getItem(storage);
    if (saved && ["CAST", "AUDIO", "LOOK", "READY"].includes(saved))
      setStep(saved as Step);
    let alive = true;
    void fetch("/api/studio/runs", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Could not restore the automatic run.");
        const data = await response.json();
        const latest = (data.runs as StudioRun[])
          .filter(
            (r) => r.projectId === projectId && r.versionId === version.id,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (alive && latest) setAutomatic(latest);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId, version.id, storage]);
  useEffect(() => {
    if (loaded.current || analysis.status === "ANALYZED") return;
    const timer = setTimeout(() => {
      loaded.current = true;
      void run("analyze").then((result) => {
        if (!result) setAnalysisFailed(true);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [analysis.id, analysis.status, run]);
  useEffect(() => {
    onRunning(automatic?.state === "RUNNING");
    return () => onRunning(false);
  }, [automatic?.state, onRunning]);
  useEffect(() => {
    if (automatic?.state !== "RUNNING" || !loop) return;
    const timer = setTimeout(
      async () => {
        if (advancing.current) return;
        advancing.current = true;
        try {
          const next = await request("advance", { runId: automatic.id });
          setAutomatic(next);
          if (next.state === "COMPLETE") await reload();
        } catch (e) {
          setLoop(false);
          setError(
            e instanceof Error
              ? e.message
              : "Connection interrupted. Reload to recover saved progress.",
          );
        } finally {
          advancing.current = false;
        }
      },
      automatic.stage === "FLOW" ? 4000 : 150,
    );
    return () => clearTimeout(timer);
    // Each response schedules exactly one next step. Credentials are request-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automatic?.id, automatic?.updatedAt, automatic?.state, loop]);
  const go = (next: Step) => {
    setStep(next);
    localStorage.setItem(storage, next);
  };
  const skipLook = () => {
    if (
      version.visualDirection?.backgroundMode === "NEW" &&
      !version.visualDirection.backgroundPrompt.trim()
    ) {
      updateVersion({
        visualDirection: {
          ...version.visualDirection,
          backgroundMode: defaults.backgroundMode,
          backgroundPrompt: defaults.backgroundPrompt,
        },
      });
    }
    go("READY");
  };
  const begin = async () => {
    setWorking(true);
    setError("");
    try {
      if (!(await run("save_version")))
        throw new Error("Save your choices before starting.");
      const started = await request("start", {
        projectId,
        versionId: version.id,
        maxCredits: budget,
        imageModel,
      });
      setAutomatic(started);
      setLoop(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start.");
    } finally {
      setWorking(false);
    }
  };
  const control = async (action: "pause" | "resume") => {
    if (!automatic) return;
    setLoop(false);
    setWorking(true);
    setError("");
    try {
      setAutomatic(
        await request(action, {
          runId: automatic.id,
          maxCredits: maxCredits ?? automatic.maxCredits,
        }),
      );
      setLoop(action === "resume");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the run.");
    } finally {
      setWorking(false);
    }
  };
  const running = automatic?.state === "RUNNING";
  return (
    <section className="stack" aria-label="Guided reenactment">
      <div className="panel stack">
        <span className="eyebrow">UPLOAD → CAST & AUDIO → FINAL VIDEO</span>
        <h2>
          {automatic
            ? automatic.state === "COMPLETE"
              ? "Your final video is ready."
              : "Building your final video."
            : "Choose your cast. We’ll handle the final cut."}
        </h2>
        <p className="hint">
          Defaults come from .env.local. Optional steps can be skipped. Keep
          Recast and the signed-in Flow browser running during generation.
        </p>
        <button
          className="button fit"
          disabled={running || working}
          onClick={onAdvanced}
        >
          Open advanced workspace
        </button>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
      </div>
      {automatic ? (
        <div className="panel stack" aria-live="polite">
          <strong>{automatic.message}</strong>
          <p>
            {automatic.stage} ·{" "}
            {Object.values(automatic.reservations).reduce((a, b) => a + b, 0)} /{" "}
            {automatic.maxCredits} Flow credits reserved
          </p>
          {automatic.error && (
            <p className="notice" role="alert">
              {automatic.error}
            </p>
          )}
          {automatic.state === "COMPLETE" && automatic.asset ? (
            <>
              <video
                key={automatic.asset}
                src={assetUrl(automatic.asset)}
                controls
                playsInline
                className="final-preview"
              />
              <a
                className="button primary"
                href={assetUrl(automatic.asset)}
                download="reenactment.mp4"
              >
                Download final MP4
              </a>
              <button
                className="button"
                onClick={() => {
                  setAutomatic(undefined);
                  go("CAST");
                }}
              >
                Adjust choices
              </button>
            </>
          ) : (
            <>
              {running ? (
                <button
                  className="button"
                  disabled={working}
                  onClick={() => control("pause")}
                >
                  Pause after current operation
                </button>
              ) : (
                <>
                  <label>
                    Flow credit limit
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={maxCredits ?? automatic.maxCredits}
                      onChange={(e) => setMaxCredits(Number(e.target.value))}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={working}
                    onClick={() => control("resume")}
                  >
                    Resume remaining work
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      setAutomatic(undefined);
                      go("READY");
                    }}
                  >
                    Change setup
                  </button>
                </>
              )}
              {!loop && running && (
                <button className="button" onClick={() => setLoop(true)}>
                  Continue saved run
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <p className="hint">
            {step === "CAST"
              ? "1 · Characters"
              : step === "AUDIO"
                ? "2 · Audio"
                : step === "LOOK"
                  ? "3 · Optional background"
                  : "Ready to generate"}
          </p>
          {step === "CAST" && (
            <>
              {analysis.status !== "ANALYZED" ? (
                <div className="panel stack">
                  <p>Analyzing the source to identify performers and motion…</p>
                  {analysisFailed && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={async () =>
                        setAnalysisFailed(!(await run("analyze")))
                      }
                    >
                      Retry source analysis
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {!analysis.speakers.length && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        run("save_analysis", {
                          value: {
                            shots: analysis.shots,
                            turns: analysis.turns,
                            speakers: [
                              {
                                id: crypto.randomUUID(),
                                name: "Main performer",
                                description:
                                  "User-selected main subject in the source footage",
                              },
                            ],
                          },
                        })
                      }
                    >
                      Add main performer to map
                    </button>
                  )}
                  <CharacterPanel
                    characters={characters}
                    analysis={analysis}
                    version={version}
                    updateVersion={updateVersion}
                    run={run}
                    busy={busy}
                  />
                  <button
                    className="button primary"
                    disabled={busy || !castReady}
                    onClick={() => go("AUDIO")}
                  >
                    Continue to audio
                  </button>
                </>
              )}
            </>
          )}
          {step === "AUDIO" && (
            <>
              <AudioPanel
                analysis={analysis}
                version={version}
                characters={characters}
                updateVersion={updateVersion}
                run={run}
                busy={busy}
              />
              <div className="inline wrap">
                <button className="button primary" onClick={() => go("LOOK")}>
                  Continue to background
                </button>
                <button className="button" onClick={() => go("READY")}>
                  Skip optional steps · use defaults
                </button>
                <button className="button" onClick={() => go("CAST")}>
                  Back
                </button>
              </div>
            </>
          )}
          {step === "LOOK" && (
            <>
              <VisualDirectionControls
                version={version}
                updateVersion={updateVersion}
                run={run}
                busy={busy}
              />
              <div className="inline wrap">
                <button className="button primary" onClick={() => go("READY")}>
                  Continue
                </button>
                <button className="button" onClick={skipLook}>
                  Skip remaining options
                </button>
                <button className="button" onClick={() => go("AUDIO")}>
                  Back
                </button>
              </div>
            </>
          )}
          {step === "READY" && (
            <div className="panel stack">
              <h3>Generate and assemble automatically.</h3>
              <p>
                {version.target === "OMNI_FLASH"
                  ? "Omni 1.1 Flash"
                  : "Veo 3.1 Lite"}{" "}
                · {version.flowSettings?.resolution} · up to{" "}
                {version.maxDuration}s · {version.aspect} ·{" "}
                {version.strategy === "FIRST_LAST"
                  ? "First + last frame"
                  : version.strategy}{" "}
                · overlap {version.overlap}s
              </p>
              <p>
                {version.visualDirection?.expression} ·{" "}
                {version.visualDirection?.backgroundMode === "NEW"
                  ? "New background"
                  : "Same background"}{" "}
                · scene completion{" "}
                {version.visualDirection?.completeScene ? "on" : "off"} · audio{" "}
                {version.audioMode}
              </p>
              <p className="hint">
                {generations} planned clips. References, each Flow generation,
                downloads, audio and final assembly run automatically.
                Image/voice requests use 9router separately from Flow credits.
                Generation is 360p when selected; the MP4 assembler normalizes
                export to 720p without an AI upscale.
              </p>
              <details>
                <summary>Optional generation settings</summary>
                <div className="stack">
                  <label>
                    Generation model
                    <select
                      aria-label="Generation model"
                      value={version.target}
                      onChange={(e) =>
                        updateVersion({
                          target: e.target.value as Version["target"],
                          maxDuration: 8,
                          flowSettings: {
                            ...version.flowSettings!,
                            resolution:
                              e.target.value === "VEO_LITE" ? "720p" : "360p",
                          },
                        })
                      }
                    >
                      <option value="OMNI_FLASH">Omni 1.1 Flash</option>
                      <option value="VEO_LITE">Veo 3.1 Lite</option>
                    </select>
                  </label>
                  <label>
                    Maximum generation duration
                    <select
                      aria-label="Maximum generation duration"
                      value={version.maxDuration}
                      onChange={(e) =>
                        updateVersion({ maxDuration: Number(e.target.value) })
                      }
                    >
                      {(version.target === "VEO_LITE"
                        ? [8]
                        : [4, 6, 8, 10]
                      ).map((d) => (
                        <option key={d} value={d}>
                          {d} seconds
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Generation resolution
                    <select
                      value={version.flowSettings?.resolution}
                      onChange={(e) =>
                        updateVersion({
                          flowSettings: {
                            ...version.flowSettings!,
                            resolution: e.target.value as "360p" | "720p",
                          },
                        })
                      }
                    >
                      <option
                        value="360p"
                        disabled={version.target === "VEO_LITE"}
                      >
                        360p
                      </option>
                      <option value="720p">720p</option>
                    </select>
                  </label>
                  <label>
                    Aspect ratio
                    <select
                      value={version.aspect}
                      onChange={(e) =>
                        updateVersion({
                          aspect: e.target.value as Version["aspect"],
                        })
                      }
                    >
                      <option value="9:16">9:16</option>
                      <option value="16:9">16:9</option>
                    </select>
                  </label>
                  <label>
                    Image provider model
                    <input
                      value={imageModel}
                      onChange={(e) => setImageModel(e.target.value)}
                    />
                  </label>
                  <label>
                    Flow project URL
                    <input
                      value={version.flowSettings?.projectUrl || ""}
                      placeholder="Leave empty to use the connected project"
                      onChange={(e) =>
                        updateVersion({
                          flowSettings: {
                            ...version.flowSettings!,
                            projectUrl: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </details>
              <label>
                Flow credit limit
                <input
                  aria-label="Flow credit limit"
                  type="number"
                  min={0}
                  max={10000}
                  value={budget}
                  onChange={(e) => setMaxCredits(Number(e.target.value))}
                />
              </label>
              <p className="hint">
                Prefilled from the planner baseline. Actual account quotes are
                checked before each submission; the run pauses rather than
                exceeding this total. No automatic paid retries.
              </p>
              <button
                className="button primary"
                disabled={working || busy || !castReady || !generations}
                onClick={begin}
              >
                Generate final MP4 · up to {budget} Flow credits
              </button>
              <button
                className="button"
                disabled={working}
                onClick={() => go("AUDIO")}
              >
                Back to audio
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
