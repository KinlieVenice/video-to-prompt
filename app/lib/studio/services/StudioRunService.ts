import { randomUUID } from "node:crypto";
import type { Analysis, Character, Project, Version } from "../types";
import type { StudioRun } from "../guided";
import type { RouterConnection } from "../connection";
import {
  getRecord,
  listRecords,
  saveRecord,
  signature,
  assetPath,
} from "../server/store";
import { guidedDefaults } from "../server/guidedDefaults";
import { reenactmentRange } from "../range";
import { probe } from "../server/ffmpeg";
import { FlowJobService } from "./FlowJobService";
import { FlowBrowserService } from "./FlowBrowserService";
import {
  flowContext,
  currentFlowContext,
  type FlowConnection,
} from "./FlowContextService";
import { KeyframeService } from "./KeyframeService";
import { VoiceService } from "./VoiceService";
import { ScenePlannerService } from "./ScenePlannerService";
import { VideoAssemblyService } from "./VideoAssemblyService";

function fingerprint(
  analysis: Analysis,
  version: Version,
  characters: Character[],
) {
  const {
    frames,
    clips,
    exportAsset,
    exportSignature,
    audioTakes,
    selectedTakes,
    ...settings
  } = version;
  void frames;
  void clips;
  void exportAsset;
  void exportSignature;
  void audioTakes;
  void selectedTakes;
  return signature({
    revision: analysis.revision,
    source: analysis.sourceHash,
    settings,
    characters: characters
      .filter((c) => Object.values(version.mappings).includes(c.id))
      .map(({ updatedAt, ...c }) => {
        void updatedAt;
        return c;
      }),
  });
}
export class StudioRunService {
  private browser: FlowConnection;
  private flow: FlowJobService;
  private keyframes: Pick<KeyframeService, "generate">;
  private voice: typeof VoiceService.generate;
  private assemble: typeof VideoAssemblyService.assemble;
  private inspect: typeof probe;
  constructor(
    deps: {
      browser?: FlowConnection;
      flow?: FlowJobService;
      keyframes?: Pick<KeyframeService, "generate">;
      voice?: typeof VoiceService.generate;
      assemble?: typeof VideoAssemblyService.assemble;
      probe?: typeof probe;
    } = {},
  ) {
    const browser = deps.browser || new FlowBrowserService();
    this.browser = browser;
    this.flow = deps.flow || new FlowJobService(browser as FlowBrowserService);
    this.keyframes = deps.keyframes || new KeyframeService();
    this.voice = deps.voice || VoiceService.generate.bind(VoiceService);
    this.assemble =
      deps.assemble || VideoAssemblyService.assemble.bind(VideoAssemblyService);
    this.inspect = deps.probe || probe;
  }
  static list() {
    return listRecords<StudioRun>("runs");
  }
  static get(id: string) {
    return getRecord<StudioRun>("runs", id);
  }
  private save(run: StudioRun) {
    run.updatedAt = new Date().toISOString();
    return saveRecord("runs", run);
  }
  private async context(projectId: string, versionId: string) {
    const project = await getRecord<Project>("projects", projectId);
    const version = project.versions.find((v) => v.id === versionId);
    if (!version) throw new Error("Select an existing version.");
    const analysis = await getRecord<Analysis>("analyses", project.analysisId);
    const characters = await listRecords<Character>("characters");
    return { project, version, analysis, characters };
  }
  async start(
    projectId: string,
    versionId: string,
    maxCredits: number,
    connection: RouterConnection,
    imageModel = guidedDefaults().imageModel,
  ) {
    if (!Number.isFinite(maxCredits) || maxCredits < 0 || maxCredits > 10000)
      throw new Error("Choose a Flow credit limit from 0 to 10000.");
    const prior = (await StudioRunService.list()).filter(
      (r) => r.state === "RUNNING",
    );
    const same = prior.find(
      (r) => r.projectId === projectId && r.versionId === versionId,
    );
    if (same) return same;
    if (prior.length)
      throw new Error("Pause or finish the active automatic run first.");
    const { project, version, analysis, characters } = await this.context(
      projectId,
      versionId,
    );
    if (analysis.status !== "ANALYZED")
      throw new Error(
        "Finish source analysis before generating the final video.",
      );
    if (!connection.imagesEnabled)
      throw new Error(
        "Image generation must be enabled for the automatic run.",
      );
    if (
      !Object.values(version.mappings).some((id) =>
        characters.some((c) => c.id === id),
      )
    )
      throw new Error("Assign at least one replacement character first.");
    if (version.audioMode === "UPLOADED" && !version.uploadedAudio)
      throw new Error("Upload your recording or choose Original audio.");
    if (version.audioMode === "CHARACTER_TTS" && !connection.ttsEnabled)
      throw new Error(
        "Enable the 9router speech route or choose Original audio.",
      );
    const connected = await this.browser.status();
    if (!connected.projectUrl) throw new Error(connected.message);
    if (!version.flowSettings?.projectUrl) {
      if (!connected.projectUrl) throw new Error(connected.message);
      version.flowSettings = {
        resolution: "360p",
        voiceName: "",
        voiceStyle: "",
        ...version.flowSettings,
        projectUrl: connected.projectUrl,
      };
    }
    if (
      !version.segments.length ||
      version.planRevision !== analysis.revision
    ) {
      version.segments = ScenePlannerService.plan(analysis, version);
      version.planRevision = analysis.revision;
      version.frames = {};
      version.clips = {};
    }
    version.exportAsset = undefined;
    version.exportSignature = undefined;
    version.clips = {}; // Reuse only matching completed Flow jobs, never stale imports.
    await saveRecord("projects", project);
    const now = new Date().toISOString();
    return this.save({
      id: randomUUID(),
      projectId,
      versionId,
      fingerprint: fingerprint(analysis, version, characters),
      state: "RUNNING",
      stage: "AUDIO",
      cursor: 0,
      jobs: {},
      reservations: {},
      maxCredits,
      imageModel,
      message: "Preparing the chosen soundtrack",
      createdAt: now,
      updatedAt: now,
    });
  }
  async pause(id: string) {
    const run = await StudioRunService.get(id);
    if (run.state !== "COMPLETE") {
      run.state = "PAUSED";
      run.message =
        "Paused after the current operation. Flow work already submitted may continue.";
    }
    return this.save(run);
  }
  async resume(id: string, maxCredits?: number) {
    const run = await StudioRunService.get(id);
    if (run.state === "COMPLETE") return run;
    if (
      (await StudioRunService.list()).some(
        (r) => r.id !== id && r.state === "RUNNING",
      )
    )
      throw new Error("Finish or pause the other run first.");
    if (maxCredits !== undefined) {
      if (
        !Number.isFinite(maxCredits) ||
        maxCredits <
          Object.values(run.reservations).reduce((a, b) => a + b, 0) ||
        maxCredits > 10000
      )
        throw new Error(
          "Credit limit cannot be below already reserved credits or above 10000.",
        );
      run.maxCredits = maxCredits;
    }
    if (run.state === "PAUSED" && run.stage === "FLOW") {
      const ctx = await this.context(run.projectId, run.versionId);
      const segment = ctx.version.segments[run.cursor];
      const jobId = segment && run.jobs[segment.id];
      if (jobId) {
        const job = await FlowJobService.get(jobId);
        if (["FAILED", "ABANDONED"].includes(job.state))
          delete run.jobs[segment.id];
        else if (job.state === "DRAFT") {
          await this.flow.dismiss(jobId);
          delete run.jobs[segment.id];
        } else if (job.state === "PREPARED" && job.error)
          await this.flow.restoreDraft(jobId);
      }
    }
    run.state = "RUNNING";
    run.error = undefined;
    return this.save(run);
  }
  async advance(id: string, connection: RouterConnection) {
    const run = await StudioRunService.get(id);
    if (run.state !== "RUNNING") return run;
    try {
      const { project, version, analysis, characters } = await this.context(
        run.projectId,
        run.versionId,
      );
      if (fingerprint(analysis, version, characters) !== run.fingerprint)
        throw new Error(
          "Project settings, source or character changed during this run. Start a new run with the updated settings.",
        );
      if (run.stage === "AUDIO") {
        const range = reenactmentRange(analysis, version);
        const turns =
          version.audioMode === "CHARACTER_TTS"
            ? analysis.turns.filter(
                (t) =>
                  t.text.trim() && t.start < range.end && t.end > range.start,
              )
            : [];
        const turn = turns[run.cursor];
        if (turn) {
          const character = characters.find(
            (c) => c.id === version.mappings[turn.speakerId],
          );
          if (!character)
            throw new Error(
              "Map every speaking actor to a saved voice before generating character audio.",
            );
          const take = await this.voice(turn, character, connection);
          const takes = (version.audioTakes[turn.id] ||= []);
          if (!takes.some((t) => t.asset === take.asset)) takes.push(take);
          version.selectedTakes[turn.id] = take.asset;
          await saveRecord("projects", project);
          const timing = version.turnTiming[turn.id] || { offset: 0, speed: 1 };
          if (
            turn.start +
              timing.offset +
              version.audioOffset +
              take.duration / (timing.speed * character.voice.speed) >
            turn.end + 0.04
          )
            throw new Error(
              `Dialogue exceeds its timing: ${turn.text.slice(0, 70)}. Adjust line timing or speed in Audio studio before generating video.`,
            );
          run.cursor++;
          run.message = `Soundtrack line ${run.cursor}/${turns.length} saved`;
        } else {
          run.stage = "FRAMES";
          run.cursor = 0;
          run.message = "Preparing character and scene references";
        }
      } else if (run.stage === "FRAMES") {
        const segment = version.segments[run.cursor];
        if (segment) {
          const frames =
            version.frames[segment.id] ||
            (await KeyframeService.extract(analysis, segment));
          version.frames[segment.id] = await this.keyframes.generate(
            analysis,
            version,
            segment,
            frames,
            characters,
            run.imageModel,
            connection,
          );
          await saveRecord("projects", project);
          run.cursor++;
          run.message = `Reference pair ${run.cursor}/${version.segments.length} saved`;
        } else {
          run.stage = "FLOW";
          run.cursor = 0;
          run.message = "Generating clips in your connected Flow browser";
        }
      } else if (run.stage === "FLOW") {
        const segment = version.segments[run.cursor];
        if (!segment) {
          run.stage = "ASSEMBLE";
          run.message = "All clips saved. Assembling the final MP4";
        } else if (version.clips[segment.id]) {
          run.cursor++;
        } else {
          let jobId = run.jobs[segment.id];
          if (!jobId) {
            const ctx = await flowContext(
              this.browser,
              project.id,
              version.id,
              segment.id,
            );
            const job = await this.flow.prepare(ctx.input, ctx.binding);
            run.jobs[segment.id] = job.id;
            await this.save(run);
            if (job.state === "FAILED")
              throw new Error(job.error || "Flow preparation failed.");
            run.message = `Clip ${run.cursor + 1}: Flow quote ${job.quote ?? "unknown"} credits`;
          } else {
            let job = await FlowJobService.get(jobId);
            await currentFlowContext(this.browser, job);
            if (job.state === "PREPARED") {
              if (job.error) throw new Error(job.error);
              const spent = Object.entries(run.reservations)
                .filter(([id]) => id !== jobId)
                .reduce((sum, [, cost]) => sum + cost, 0);
              if (job.quote === undefined || spent + job.quote > run.maxCredits)
                throw new Error(
                  `Flow quote exceeds this run's ${run.maxCredits}-credit limit. Increase the limit to continue.`,
                );
              run.reservations[jobId] = job.quote;
              await this.save(run); // Reserve before any irreversible submission.
              job = await this.flow.submit(jobId, run.maxCredits - spent);
              if (job.state !== "RUNNING" && job.state !== "COMPLETE")
                throw new Error(job.error || "Flow submission needs review.");
            } else if (job.state === "RUNNING") {
              job = await this.flow.refresh(jobId);
              if (job.state === "FAILED")
                throw new Error(
                  "Flow generation failed. Review this job in the Flow workspace.",
                );
            } else if (job.state === "COMPLETE") {
              job = await this.flow.download(jobId);
              if (!job.asset) throw new Error("Flow result was not saved.");
              const media = await this.inspect(assetPath(job.asset));
              version.clips[segment.id] = {
                asset: job.asset,
                media,
                trim: 0,
                sourceName: `Flow clip ${run.cursor + 1}`,
                importedAt: new Date().toISOString(),
              };
              await saveRecord("projects", project);
              run.cursor++;
            } else
              throw new Error(
                job.error ||
                  "Flow submission needs review; no automatic retry will be made.",
              );
            run.message = `Clips saved ${run.cursor}/${version.segments.length}`;
          }
        }
      } else {
        const output = await this.assemble(analysis, version, characters);
        version.exportAsset = output.asset;
        version.exportSignature = output.signature;
        await saveRecord("projects", project);
        run.asset = output.asset;
        run.state = "COMPLETE";
        run.message = "Your final video is assembled and ready to download";
      }
    } catch (error) {
      run.state = "PAUSED";
      run.error =
        error instanceof Error
          ? error.message
          : "Automatic run needs attention.";
      run.message = "Paused; completed outputs remain saved";
    }
    return this.save(run);
  }
}
