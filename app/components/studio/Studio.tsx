"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  Layers3,
  Loader2,
  Plus,
  Settings,
  Upload,
  Users,
  X,
} from "lucide-react";
import { RouterSettingsDialog } from "./RouterSettingsDialog";
import {
  defaultConnection,
  loadConnection,
  saveConnection,
  type PublicRouterSettings,
} from "../../lib/studio/connection";
import type { StudioState, Version } from "../../lib/studio/types";
import { assetUrl, seconds } from "../../lib/studio/types";
import { reenactmentRange } from "../../lib/studio/range";
import { visualDirectionChanged } from "../../lib/studio/visualDirection";
import { appearanceChanged } from "../../lib/studio/appearance";
import { studioRequest, type StudioResponse } from "../../lib/studio/client";
import { SourcePanel } from "./SourcePanel";
import { CharacterPanel } from "./CharacterPanel";
import { AudioPanel } from "./AudioPanel";
import { FlowPanel } from "./FlowPanel";
import { ExportPanel } from "./ExportPanel";
import { GuidedStudio } from "./GuidedStudio";
import { NicheStudio } from "./NicheStudio";
import {
  guidedDefaultsSchema,
  type GuidedDefaults,
} from "../../lib/studio/guided";

export type StudioAction = (
  action: string,
  payload?: Record<string, unknown>,
  file?: File,
) => Promise<StudioResponse | undefined>;
type Tab = "source" | "characters" | "audio" | "flow" | "export" | "niches";
const TABS = [
  {
    id: "niches" as Tab,
    label: "Niche generator",
    sub: "Topic to final video",
    icon: Layers3,
  },
  {
    id: "source" as Tab,
    label: "Source & analysis",
    sub: "Understand the performance",
    icon: Film,
  },
  {
    id: "characters" as Tab,
    label: "Character library",
    sub: "Cast any character",
    icon: Users,
  },
  {
    id: "audio" as Tab,
    label: "Audio studio",
    sub: "Keep every word",
    icon: AudioLines,
  },
  {
    id: "flow" as Tab,
    label: "Flow workspace",
    sub: "Generate shot by shot",
    icon: Layers3,
  },
  {
    id: "export" as Tab,
    label: "Assemble & export",
    sub: "Make the final cut",
    icon: Clapperboard,
  },
];
export function Studio() {
  const [data, setData] = useState<StudioState>({
    projects: [],
    analyses: [],
    characters: [],
  });
  const [projectId, setProjectId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [tab, setTab] = useState<Tab>("source");
  const [settings, setSettings] = useState(false);
  const [connection, setConnection] = useState(defaultConnection);
  const [routerSettings, setRouterSettings] = useState<PublicRouterSettings>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [workflow, setWorkflow] = useState("GUIDED");
  const [autoActive, setAutoActive] = useState(false);
  const [defaults, setDefaults] = useState<GuidedDefaults>(() =>
    guidedDefaultsSchema.parse({}),
  );
  const [saved, setSaved] = useState(true);
  const [download, setDownload] = useState<string>();
  const [ffmpegReady, setFfmpegReady] = useState(true);
  const uploadRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const project = data.projects.find((p) => p.id === projectId);
  const analysis = data.analyses.find((a) => a.id === project?.analysisId);
  const version =
    project?.versions.find((v) => v.id === versionId) || project?.versions[0];
  const selectedRange =
    analysis && version ? reenactmentRange(analysis, version) : undefined;
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/studio", { cache: "no-store" });
      const json: StudioResponse = await response.json();
      if (!response.ok)
        throw new Error(json.error || "Could not open local projects.");
      setData(json);
      if (json.guidedDefaults) setDefaults(json.guidedDefaults);
      setWorkflow(localStorage.getItem("studio:workflow") || "GUIDED");
      setRouterSettings(json.routerSettings);
      setConnection(loadConnection(json.routerSettings));
      setFfmpegReady(json.ffmpegReady ?? false);
      setProjectId((current) => {
        const candidate = current || localStorage.getItem("studio:project");
        return json.projects.some((p) => p.id === candidate)
          ? candidate!
          : json.projects[0]?.id || "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load studio.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (projectId) localStorage.setItem("studio:project", projectId);
  }, [projectId]);
  const updateVersion = (patch: Partial<Version>) => {
    if (!project || !version) return;
    const planChange = Object.keys(patch).some((key) =>
      [
        "target",
        "maxDuration",
        "overlap",
        "strategy",
        "ultra",
        "creditOverride",
      ].includes(key),
    );
    const changed = {
      ...version,
      ...patch,
      exportAsset: undefined,
      exportSignature: undefined,
      ...(planChange ? { planRevision: undefined } : {}),
    };
    const visualsChanged =
      visualDirectionChanged(version, changed) ||
      appearanceChanged(version, changed);
    if (visualsChanged) changed.clips = {};
    if (visualsChanged || version.aspect !== changed.aspect) {
      changed.frames = Object.fromEntries(
        Object.entries(version.frames).map(([id, frames]) => [
          id,
          { ...frames, generated: undefined },
        ]),
      );
    }
    setData((current) => ({
      ...current,
      projects: current.projects.map((p) =>
        p.id === project.id
          ? {
              ...p,
              versions: p.versions.map((v) =>
                v.id === version.id ? changed : v,
              ),
            }
          : p,
      ),
    }));
    setSaved(false);
  };
  const run: StudioAction = async (action, payload = {}, file) => {
    if (pending.current) return;
    pending.current = true;
    setError("");
    setDownload(undefined);
    const labels: Record<string, string> = {
      create_project: "Scanning cuts and audio locally…",
      analyze: "Transcribing locally and analyzing timestamped frames…",
      refine_motion:
        "Refining motion timing and key poses; preserving your transcript…",
      generate_line: "Generating this speaker turn…",
      generate_frames: "Preparing character-replaced reference frames…",
      assemble: "Validating, trimming and assembling with FFmpeg…",
      design_voice: "Designing a reusable voice…",
    };
    setBusy(labels[action] || "Saving to your local studio…");
    try {
      const context = {
        projectId: project?.id,
        versionId: version?.id,
        ...([
          "analyze",
          "refine_motion",
          "generate_line",
          "generate_frames",
          "preview_voice",
          "design_voice",
        ].includes(action)
          ? { connection }
          : {}),
        ...payload,
      };
      if (
        project &&
        version &&
        action !== "create_project" &&
        action !== "save_version" &&
        !saved
      )
        await studioRequest("save_version", {
          projectId: project.id,
          versionId: version.id,
          value: version,
        });
      const json = await studioRequest(
        action,
        action === "save_version"
          ? { ...context, value: payload.value ?? version }
          : context,
        file,
      );
      setData(json);
      setSaved(true);
      if (json.projectId) {
        setProjectId(json.projectId);
        setVersionId("");
        setTab("source");
      }
      if (json.versionId) setVersionId(json.versionId);
      if (json.asset) setDownload(json.asset);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
      return undefined;
    } finally {
      setBusy("");
      pending.current = false;
    }
  };
  const switchProject = async (id: string) => {
    if (!saved && project && version) {
      if (!(await run("save_version"))) return;
    }
    setProjectId(id);
    setVersionId("");
    setSaved(true);
    setDownload(undefined);
  };
  const switchVersion = async (id: string) => {
    if (!saved) {
      if (!(await run("save_version"))) return;
    }
    setVersionId(id);
    setSaved(true);
    setDownload(undefined);
  };
  const onUpload = (file?: File) => {
    if (file)
      void run("create_project", { guided: workflow === "GUIDED" }, file);
  };
  const guided = workflow === "GUIDED" && version?.workflow === "GUIDED";
  const changeWorkflow = (value: string) => {
    localStorage.setItem("studio:workflow", value);
    setWorkflow(value);
  };
  const nav = TABS.find((t) => t.id === tab)!;
  return (
    <div className="studio">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          aria-label="AI Video Reenactment Studio home"
        >
          <div className="brand-mark">
            <Clapperboard size={23} />
          </div>
          <span>
            RE<span className="brand-slash">/</span>CAST
            <small>VIDEO REENACTMENT STUDIO</small>
          </span>
        </a>
        <div className="sidebar-section">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <label className="project-picker">
            <FolderOpen size={16} />
            <select
              aria-label="Current project"
              value={project?.id || ""}
              disabled={!!busy || autoActive}
              onChange={(e) => switchProject(e.target.value)}
            >
              <option value="" disabled>
                Select a project
              </option>
              {data.projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button new-project"
            disabled={!!busy || autoActive}
            onClick={() => uploadRef.current?.click()}
          >
            <Plus size={15} />
            New project
          </button>
        </div>
        <nav className="step-nav">
          {TABS.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                disabled={!!busy || autoActive}
                className={tab === item.id ? "active" : ""}
                onClick={() => {
                  if (!autoActive) {
                    changeWorkflow("ADVANCED");
                    setTab(item.id);
                  }
                }}
              >
                <Icon size={19} />
                <span>
                  {item.label}
                  <small>{item.sub}</small>
                </span>
                <span className="step-index">0{i + 1}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            LOCAL-FIRST WORKSPACE
          </div>
          <p>
            Projects and media are saved locally. OpenAI analysis uses your
            configured 9router connection.
          </p>
          <button
            className="sidebar-settings"
            disabled={!loaded || !!busy}
            onClick={() => setSettings(true)}
          >
            <Settings size={16} />
            API & model settings
            <ChevronRight size={15} />
          </button>
          <a
            className="sidebar-link"
            href="https://github.com/imooooc/video-to-prompt"
            target="_blank"
            rel="noreferrer"
          >
            Built on video-to-prompt
            <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      <div className="studio-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Studio</span>
            <ChevronRight size={13} />
            <strong>{project?.name || "New workspace"}</strong>
          </div>
          <div className="inline">
            <span
              className={`key-status ${connection.model ? "connected" : ""}`}
            >
              <i />
              {connection.model ? "OpenAI via 9router" : "Set up 9router"}
            </span>
            <button
              className="icon-button"
              aria-label="Open settings"
              disabled={!loaded || !!busy}
              onClick={() => setSettings(true)}
            >
              <Settings size={17} />
            </button>
          </div>
        </header>
        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">AI VIDEO REENACTMENT STUDIO</span>
              <h1>{nav.label}</h1>
              <p className="muted">
                {tab === "source"
                  ? "Preserve the scene. Reimagine the cast."
                  : nav.sub + ". Build on the same source analysis."}
              </p>
            </div>
            {project && version && (
              <div className="version-controls">
                <select
                  aria-label="Current character version"
                  value={version.id}
                  disabled={!!busy || autoActive}
                  onChange={(e) => switchVersion(e.target.value)}
                >
                  {project.versions.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  className="button"
                  disabled={!!busy || autoActive}
                  title="Create another character version using the same analysis"
                  onClick={() => run("duplicate_version")}
                >
                  <Plus size={14} />
                  Version
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div className="progress-banner" role="status">
              <Loader2 size={16} className="animate-spin" />
              {busy}
            </div>
          )}
          {download && (
            <div className="download-banner">
              <Check size={16} />
              <span>Your reusable file is ready.</span>
              <a href={assetUrl(download)} download className="button">
                <Download size={14} />
                Download {download.endsWith(".wav") ? "WAV" : "Flow package"}
              </a>
            </div>
          )}
          {!ffmpegReady && loaded && (
            <p className="notice">
              FFmpeg or FFprobe is missing. Install dependencies, or set
              FFMPEG_PATH and FFPROBE_PATH to your local binaries.
            </p>
          )}
          {project &&
            version?.workflow === "GUIDED" &&
            analysis &&
            !guided &&
            !busy &&
            !autoActive && (
              <button
                className="button"
                onClick={() => changeWorkflow("GUIDED")}
              >
                Open guided setup
              </button>
            )}
          {guided && project && version && analysis && (
            <GuidedStudio
              key={`${project.id}-${version.id}`}
              projectId={project.id}
              analysis={analysis}
              version={version}
              characters={data.characters}
              defaults={defaults}
              connection={connection}
              updateVersion={updateVersion}
              run={run}
              busy={!!busy}
              reload={load}
              onRunning={setAutoActive}
              onAdvanced={() => changeWorkflow("ADVANCED")}
            />
          )}
          {!guided && (
            <div>
              <fieldset
                disabled={!!busy || (autoActive && tab !== "niches")}
                className="studio-fields"
                aria-busy={!!busy}
              >
                {!loaded ? (
                  <section className="panel empty-workspace">
                    <Loader2 size={26} className="animate-spin" />
                    <p>Opening your local studio…</p>
                  </section>
                ) : (
                  <>
                    {tab === "niches" && (
                      <NicheStudio
                        characters={data.characters}
                        connection={connection}
                        onRunning={setAutoActive}
                        onCharacters={() => setTab("characters")}
                        reload={load}
                      />
                    )}
                    {project && version && analysis && (
                      <>
                        <div className="project-ribbon">
                          <span className="badge">{analysis.sourceName}</span>
                          <span>
                            {seconds(selectedRange!.end - selectedRange!.start)}{" "}
                            output · source {seconds(selectedRange!.start)}–
                            {seconds(selectedRange!.end)}
                          </span>
                          <span>
                            Full source {seconds(analysis.media.duration)} ·{" "}
                            {analysis.shots.length} shots
                          </span>
                          <label>
                            Version name
                            <input
                              value={version.name}
                              onChange={(e) =>
                                updateVersion({ name: e.target.value })
                              }
                            />
                          </label>
                          <button
                            className="button small-button"
                            disabled={!!busy || saved}
                            onClick={() => run("save_version")}
                          >
                            <Check size={13} />
                            {saved ? "Version saved" : "Save version settings"}
                          </button>
                        </div>
                        <div hidden={tab !== "source"}>
                          <SourcePanel
                            key={`${analysis.id}-${analysis.revision}`}
                            analysis={analysis}
                            version={version}
                            run={run}
                            busy={!!busy}
                          />
                        </div>
                      </>
                    )}
                    <div hidden={tab !== "characters"}>
                      <CharacterPanel
                        characters={data.characters}
                        analysis={analysis}
                        version={version}
                        updateVersion={updateVersion}
                        run={run}
                        busy={!!busy}
                      />
                    </div>
                    {project && version && analysis ? (
                      <>
                        <div hidden={tab !== "audio"}>
                          <AudioPanel
                            analysis={analysis}
                            version={version}
                            characters={data.characters}
                            updateVersion={updateVersion}
                            run={run}
                            busy={!!busy}
                          />
                        </div>
                        <div hidden={tab !== "flow"}>
                          <FlowPanel
                            projectId={project!.id}
                            onImported={load}
                            analysis={analysis}
                            version={version}
                            characters={data.characters}
                            updateVersion={updateVersion}
                            run={run}
                            busy={!!busy}
                          />
                        </div>
                        <div hidden={tab !== "export"}>
                          <ExportPanel
                            analysis={analysis}
                            version={version}
                            updateVersion={updateVersion}
                            run={run}
                            busy={!!busy}
                          />
                        </div>
                      </>
                    ) : (
                      tab !== "characters" &&
                      tab !== "niches" && (
                        <>
                          <section className="welcome-panel">
                            <div className="welcome-copy">
                              <span className="eyebrow">
                                THE PERFORMANCE IS THE BLUEPRINT.
                              </span>
                              <h2>
                                Same scene.
                                <br />A whole new cast<span>.</span>
                              </h2>
                              <p>
                                Turn a reference video into a reusable
                                reenactment. Analyze the action, cast your
                                characters, keep the dialogue, and bring it all
                                together.
                              </p>
                              <div className="welcome-tags">
                                <span>Any character</span>
                                <span>Original audio first</span>
                                <span>Manual Google Flow</span>
                              </div>
                            </div>
                            <div className="welcome-visual" aria-hidden="true">
                              <div className="frame-outline frame-back" />
                              <div className="frame-outline frame-front">
                                <span>SCENE 01 / TAKE 02</span>
                                <Clapperboard size={64} strokeWidth={1} />
                                <div className="frame-footer">
                                  <span className="record-dot" />
                                  REIMAGINE THE CAST<span>00:00:08</span>
                                </div>
                              </div>
                              <div className="visual-caption">
                                YOUR SOURCE. YOUR CHARACTERS.
                              </div>
                            </div>
                          </section>
                          <label
                            className={`upload-zone ${busy ? "disabled" : ""}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (!busy) onUpload(e.dataTransfer.files[0]);
                            }}
                          >
                            <div className="upload-icon">
                              <Upload size={24} />
                            </div>
                            <h3>Drop your source video here</h3>
                            <span>or click to browse your files</span>
                            <small>
                              MP4 or MOV · up to 512 MB / 10 minutes · local
                              scan first
                            </small>
                            <input
                              disabled={!!busy || autoActive}
                              type="file"
                              accept=".mp4,.mov"
                              onChange={(e) => {
                                onUpload(e.target.files?.[0]);
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <div className="workflow-cards">
                            {[
                              {
                                n: "01",
                                title: "Analyze once",
                                text: "Measured scene cuts, speaker turns and a correctable transcript.",
                              },
                              {
                                n: "02",
                                title: "Recast endlessly",
                                text: "Reusable characters, reference images and saved voices.",
                              },
                              {
                                n: "03",
                                title: "Make the final cut",
                                text: "Manual Flow generation. Local FFmpeg assembly.",
                              },
                            ].map((item) => (
                              <div key={item.n}>
                                <span>{item.n}</span>
                                <h3>{item.title}</h3>
                                <p>{item.text}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    )}
                  </>
                )}
              </fieldset>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <span className="status-dot" />
              Local storage · Manual generation · Reusable assets
            </span>
            <a
              href="https://github.com/decolua/9router"
              target="_blank"
              rel="noreferrer"
            >
              9router setup ↗
            </a>
          </footer>
        </main>
      </div>
      <input
        ref={uploadRef}
        className="hidden"
        type="file"
        accept=".mp4,.mov"
        onChange={(e) => {
          onUpload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <RouterSettingsDialog
        open={settings}
        initial={connection}
        serverSettings={routerSettings}
        onClose={() => setSettings(false)}
        onSave={(next) => {
          saveConnection(next);
          setConnection(next);
          setSettings(false);
        }}
      />
    </div>
  );
}
