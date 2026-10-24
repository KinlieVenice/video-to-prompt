"use client";
import { useEffect, useState } from "react";
import type { FlowJob, FlowSettings } from "../../lib/studio/flow";
import type { Version } from "../../lib/studio/types";
import { assetUrl } from "../../lib/studio/types";
import type { StudioAction } from "./Studio";
type Connection = {
  connected: boolean;
  signedIn: boolean;
  message: string;
  projectUrl?: string;
};
export function FlowBridgePanel({
  projectId,
  version,
  updateVersion,
  run,
  onImported,
  disabled,
  stale,
}: {
  projectId: string;
  version: Version;
  updateVersion: (patch: Partial<Version>) => void;
  run: StudioAction;
  onImported: () => Promise<void>;
  disabled: boolean;
  stale: boolean;
}) {
  const [jobs, setJobs] = useState<FlowJob[]>([]);
  const [connection, setConnection] = useState<Connection>();
  const [segmentId, setSegmentId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const settings: FlowSettings = version.flowSettings || {
    projectUrl: "",
    resolution: version.target === "VEO_LITE" ? "720p" : "360p",
    voiceName: "",
    voiceStyle: "",
  };
  const patch = (value: Partial<FlowSettings>) =>
    updateVersion({ flowSettings: { ...settings, ...value } });
  async function load(checkConnection = false) {
    const response = await fetch(
      `/api/studio/flow${checkConnection ? "" : "?jobsOnly=1"}`,
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not open Flow jobs.");
    setJobs(data.jobs);
    if (data.connection) setConnection(data.connection);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [projectId, version.id]);
  async function action(name: string, body: Record<string, unknown> = {}) {
    if (busy || disabled) return;
    setBusy(name);
    setError("");
    try {
      if (
        ["prepare", "submit", "import"].includes(name) &&
        !(await run("save_version"))
      )
        throw new Error("Save the version before using Flow.");
      if (name === "connect") {
        await load(true);
        return;
      }
      const response = await fetch("/api/studio/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Flow operation failed.");
      await load();
      if (name === "import") await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Flow bridge failed.");
    } finally {
      setBusy("");
    }
  }
  const selected =
    version.segments.find((s) => s.id === segmentId) || version.segments[0];
  const visibleJobs = jobs
    .filter(
      (j) =>
        j.binding?.projectId === projectId &&
        j.binding.versionId === version.id,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const locked = Boolean(busy) || disabled;
  return (
    <section className="panel stack" aria-label="Local Flow bridge">
      <span className="eyebrow">EXPERIMENTAL / LOCAL FLOW BRIDGE</span>
      <h3>Send a planned segment to your signed-in Flow browser.</h3>
      <p className="hint">
        Keep the dedicated Chrome process running. Preparing uploads references
        and reads the live quote. Generate submits one output using your Flow
        credits. No Google API key is required.
      </p>
      <div className="inline wrap">
        <button
          className="button"
          disabled={locked}
          onClick={() => action("connect")}
        >
          Check Flow connection
        </button>
        {connection && <span role="status">{connection.message}</span>}
        {connection?.projectUrl && (
          <button
            className="button"
            disabled={locked}
            onClick={() => patch({ projectUrl: connection.projectUrl! })}
          >
            Use connected project
          </button>
        )}
      </div>
      <div className="three-cols">
        <label>
          Flow project URL
          <input
            value={settings.projectUrl}
            onChange={(e) => patch({ projectUrl: e.target.value })}
            placeholder="https://flow.google.com/project/..."
          />
          <span className="hint">
            Leave empty to use the open Flow project.
          </span>
        </label>
        <label>
          Bridge output resolution
          <select
            value={settings.resolution}
            onChange={(e) =>
              patch({
                resolution: e.target.value as FlowSettings["resolution"],
              })
            }
          >
            <option value="360p" disabled={version.target === "VEO_LITE"}>
              360p · Omni Flash
            </option>
            <option value="720p">720p</option>
          </select>
        </label>
        <label>
          Segment
          <select
            value={selected?.id || ""}
            onChange={(e) => setSegmentId(e.target.value)}
          >
            {version.segments.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1} · {s.start.toFixed(2)}–{s.end.toFixed(2)}s ·{" "}
                {s.duration}s generation
              </option>
            ))}
          </select>
        </label>
        <label>
          Optional Flow voice name
          <input
            value={settings.voiceName}
            onChange={(e) => patch({ voiceName: e.target.value })}
            placeholder="Preset name from Flow Voices"
          />
          <span className="hint">
            Omni Ingredients only; one voice reference per job.
          </span>
        </label>
        <label>
          Voice performance
          <input
            value={settings.voiceStyle}
            onChange={(e) => patch({ voiceStyle: e.target.value })}
            placeholder="Optional performance instructions"
          />
        </label>
      </div>
      {settings.voiceName && (
        <p className="notice">
          Flow voice references require Ingredients and a visual reference.
          Start/End frames use a separate mode. Final export currently uses{" "}
          {version.audioMode}; choose generated-clip audio to keep Flow voices.
        </p>
      )}
      <p className="hint">
        Model, aspect, strategy and duration come from the selected version and
        segment. The inspected Veo Lite interface requires 720p and 8 seconds.
        Planner estimates are separate from the live bridge quote.
      </p>
      <button
        className="button fit"
        disabled={locked || stale || !selected}
        onClick={() =>
          action("prepare", {
            projectId,
            versionId: version.id,
            segmentId: selected?.id,
            settings,
          })
        }
      >
        Prepare selected segment · no generation
      </button>
      {busy && <p role="status">Flow: {busy}… Keep its browser window open.</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {visibleJobs.map((job) => (
        <div
          key={job.id}
          className="stack panel"
          aria-label={`Flow job ${job.id}`}
        >
          <div className="inline wrap">
            <strong>
              Segment{" "}
              {version.segments.findIndex(
                (s) => s.id === job.binding?.segmentId,
              ) + 1}
            </strong>
            <span className="badge">{job.state}</span>
            <span>
              {job.input.duration}s · {job.input.settings.resolution} ·{" "}
              {job.input.aspect}
            </span>
            <span>{job.quote ?? "Unknown"} credits</span>
          </div>
          {job.error && <p className="notice">{job.error}</p>}
          <details>
            <summary>Review settings, references and prompt</summary>
            <p className="hint">
              {job.input.model} · {job.input.mode} · Voice:{" "}
              {job.input.settings.voiceName || "No voice reference"}
            </p>
            <div className="frame-pair">
              {[job.input.first, job.input.last, ...job.input.references]
                .filter((a): a is string => Boolean(a))
                .map((asset, i) => (
                  <img
                    key={`${asset}-${i}`}
                    src={assetUrl(asset)}
                    alt={`Flow job reference ${i + 1}`}
                  />
                ))}
            </div>
            <pre className="prompt-text">{job.input.prompt}</pre>
          </details>
          <div className="inline wrap">
            {job.state === "PREPARED" && (
              <button
                className="button primary"
                disabled={locked || stale || job.quote === undefined}
                onClick={() =>
                  action("submit", { jobId: job.id, maxCredits: job.quote })
                }
              >
                Generate one clip · {job.quote} credits
              </button>
            )}
            {(["RUNNING", "SUBMITTING", "UNKNOWN"].includes(job.state) ||
              (job.upscale &&
                ["RUNNING", "SUBMITTING", "UNKNOWN"].includes(
                  job.upscale.state,
                ))) && (
              <button
                className="button"
                disabled={locked}
                onClick={() => action("refresh", { jobId: job.id })}
              >
                Refresh status
              </button>
            )}
            {job.state === "COMPLETE" && !job.asset && (
              <button
                className="button"
                disabled={locked}
                onClick={() => action("download", { jobId: job.id })}
              >
                Download original result
              </button>
            )}
            {job.asset && (
              <>
                <a className="button" href={assetUrl(job.asset)} download>
                  Save original MP4
                </a>
                <button
                  className="button"
                  disabled={locked || stale}
                  onClick={() => action("import", { jobId: job.id })}
                >
                  Use original in this segment
                </button>
              </>
            )}
            {job.state === "COMPLETE" &&
              job.input.model === "OMNI_FLASH" &&
              job.input.settings.resolution === "360p" &&
              !job.upscale && (
                <button
                  className="button"
                  disabled={locked}
                  onClick={() => action("upscale", { jobId: job.id })}
                >
                  Upscale to 720p · free only
                </button>
              )}
            {job.upscale && <span>720p: {job.upscale.state}</span>}
            {job.upscale?.error && (
              <p className="notice">{job.upscale.error}</p>
            )}
            {job.upscale?.state === "COMPLETE" && !job.upscale.asset && (
              <button
                className="button"
                disabled={locked}
                onClick={() =>
                  action("download", { jobId: job.id, upscaled: true })
                }
              >
                Download 720p result
              </button>
            )}
            {job.upscale?.asset && (
              <>
                <a
                  className="button"
                  href={assetUrl(job.upscale.asset)}
                  download
                >
                  Save 720p MP4
                </a>
                <button
                  className="button"
                  disabled={locked || stale}
                  onClick={() =>
                    action("import", { jobId: job.id, upscaled: true })
                  }
                >
                  Use 720p in this segment
                </button>
              </>
            )}
            {job.state === "COMPLETE" && (
              <button
                className="button"
                disabled={locked || stale}
                onClick={() =>
                  action("prepare", {
                    projectId,
                    versionId: version.id,
                    segmentId: job.binding?.segmentId,
                    settings: job.input.settings,
                    newAttempt: true,
                  })
                }
              >
                Prepare another take · no generation
              </button>
            )}
            {job.state !== "ABANDONED" &&
              (job.state !== "COMPLETE" ||
                (job.upscale &&
                  ["RUNNING", "SUBMITTING", "UNKNOWN"].includes(
                    job.upscale.state,
                  ))) && (
                <button
                  className="button"
                  disabled={locked}
                  onClick={() => action("dismiss", { jobId: job.id })}
                >
                  Dismiss local tracking
                </button>
              )}
          </div>
          {["UNKNOWN", "SUBMITTING", "RUNNING"].includes(job.state) && (
            <p className="hint">
              Dismissing local tracking does not cancel generation in Flow.
              Check Flow before preparing another attempt.
            </p>
          )}
          {job.asset && (
            <video
              src={assetUrl(job.upscale?.asset || job.asset)}
              controls
              playsInline
              preload="metadata"
            />
          )}
        </div>
      ))}
    </section>
  );
}
