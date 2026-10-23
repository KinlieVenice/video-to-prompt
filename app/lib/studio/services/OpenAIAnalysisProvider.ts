import { z } from "zod";
import type { RouterConnection } from "../connection";
import type {
  Analysis,
  MotionBeat,
  Speaker,
  Shot,
  Interval,
  MotionWindowState,
} from "../types";
import { speakerSchema, continuityStateSchema } from "../validation";
import {
  assetPath,
  cacheGet,
  newAsset,
  saveRecord,
  signature,
} from "../server/store";
import { run } from "../server/ffmpeg";
import { chatJson, routerBaseUrl } from "../server/openai";
import { SpeakerDiarizationService } from "./SpeakerDiarizationService";
import {
  MotionAnalysisService as Motion,
  rawBeatSchema,
} from "./MotionAnalysisService";

const visualSchema = z.object({
  description: z.string().max(20_000),
  camera: z.string().max(20_000),
  lighting: z.string().max(20_000),
  motionBeats: z.array(rawBeatSchema).max(80),
  speakers: z.array(speakerSchema).max(200),
  endingState: continuityStateSchema.optional(),
});

export class OpenAIAnalysisProvider {
  static frameTimes(shot: Shot, fps: number) {
    return Motion.frameTimes(shot, fps);
  }

  static prompt(
    shot: Shot,
    window: Interval,
    speakers: Speaker[],
    turns: Analysis["turns"],
    previous: MotionBeat[],
    refinement?: MotionBeat[],
    continuity?: MotionWindowState,
  ) {
    return `Analyze timestamped frames of ONE continuous shot. Source interval ${window.start}-${window.end} seconds; shot ${shot.start}-${shot.end}s. Return ONLY JSON {"description":"composition, actors, clothing, background, expressions","camera":"angle and movement","lighting":"...","speakers":[{"id":"existing ID or actor_${shot.id.slice(0, 8)}_N","name":"Actor label","description":"appearance and position; uncertainty"}],"endingState":{"pose":"actor positions at LAST supplied frame","hands":"consistent hand/limb positions","objects":"object positions, orientation and condition","ongoingAction":"action still underway or none","settled":false},"motionBeats":[{"start":0.0,"end":0.5,"timingKind":"ACTIVITY|TRANSITION|OBSERVATION","onset":null,"continuing":false,"settled":false,"stateBefore":"visible state in before evidence frame","stateAfter":"visible state in after evidence frame","action":"observable activity/change","phase":"SETUP|ACTION|REACTION|RECOVERY|HOLD","importance":"KEY|NORMAL","confidence":"LOW|MEDIUM|HIGH","anchorTime":0.5}]}.
TIMING: start/end describe the span over which an activity is observed, or the before/after range of a transition. ACTIVITY means sustained motion; TRANSITION means a visible state change; OBSERVATION means a sampled pose. Onset is SEPARATE: use {"start":beforeSample,"end":afterSample} only when you see evidence bracketing when an action begins. Otherwise onset=null. Never treat a multi-second activity span as onset uncertainty. If an action is already underway at the start of this window, continuing=true and onset=null; never restart it. For beats with an onset bracket, stateBefore/stateAfter describe those two onset evidence frames; otherwise describe the beat's first/last observed states. AnchorTime must be a supplied sample inside start/end. Do not claim a sampled pose proves exact onset. Mark pivotal actions/reactions KEY. Use screen-left/screen-right and consistent actor/hand/prop labels.
CONTINUITY: ${window.start === shot.start ? "This is the start of the camera shot; a SETUP observation is allowed here." : `This is a continuation window, NOT a new scene. Do not output SETUP. Incoming state as of ${continuity?.frameTime ?? window.start}s: ${JSON.stringify(continuity?.state || {})}. Maintain pose, hand/limb positions and object condition from the continuity image. Describe only new actions in this window; carry ongoing actions without replaying them.`}
RECOVERY is allowed only when an observed stabilized/settled state is shown: settled=true AND a concrete stateAfter. An attempted intervention while a hazard or failure is still active is ACTION, not recovery. Do not force a complete setup/action/reaction/recovery arc within each window. Preserve cause before reaction without inventing a causal link. No speech, vocal emotion, real identity or character replacements can be inferred from frames. Model confidence is not a calibrated probability; evidence and human review determine timing trust.
Transcript evidence, unchanged: ${JSON.stringify(turns)}. Existing actors (keep IDs; never map unassigned audio speakers from images alone): ${JSON.stringify(speakers)}. Prior-window motion context (do NOT repeat events outside this window): ${JSON.stringify(previous.slice(-4))}. Existing shot description: ${shot.description}.
${refinement ? `REFINEMENT PASS: Additional quarter-second observations have been added around key events. Re-evaluate ALL beats for this window, returning a complete replacement list. Narrow brackets only when the new frames support it; correct earlier guesses rather than blindly retaining them. Previous draft: ${JSON.stringify(refinement)}.` : "Initial motion pass. Use all supplied frames in order, including samples near rapid measured image changes."}`;
  }

  static async analyze(
    analysis: Analysis,
    connection: RouterConnection,
    motionOnly = false,
  ): Promise<Analysis> {
    if (analysis.status === "ANALYZED" && !motionOnly) return analysis;
    if (!connection.model)
      throw new Error(
        "Select your OpenAI model in API & model settings first.",
      );
    const baseUrl = routerBaseUrl(connection.baseUrl);
    let speech = { speakers: analysis.speakers, turns: analysis.turns };
    // Motion-only refinement never invokes speech recognition, even for an empty transcript.
    if (
      !motionOnly &&
      analysis.media.hasAudio &&
      !analysis.turns.length &&
      connection.transcription !== "MANUAL"
    ) {
      const speechKey = `speech-openai-${signature({
        source: analysis.sourceHash,
        mode: connection.transcription,
        language: connection.language,
        model:
          connection.transcription === "LOCAL"
            ? process.env.STUDIO_WHISPER_MODEL || "small"
            : connection.transcriptionModel,
        route: connection.transcription === "LOCAL" ? "local" : baseUrl,
        version: 1,
      })}`;
      const cached = await cacheGet<typeof speech>(speechKey);
      if (cached) speech = { speakers: cached.speakers, turns: cached.turns };
      else {
        const audio = await newAsset("wav");
        await run("ffmpeg", [
          "-y",
          "-i",
          assetPath(analysis.sourceAsset),
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          audio.path,
        ]);
        speech = await SpeakerDiarizationService.transcribe(
          analysis,
          audio.asset,
          connection,
        );
        await saveRecord("cache", { id: speechKey, ...speech });
      }
    }
    const speakers: Speaker[] = [
      ...analysis.speakers,
      ...speech.speakers.filter(
        (s) => !analysis.speakers.some((a) => a.id === s.id),
      ),
    ];
    const scores = await Motion.changes(
      analysis.sourceHash,
      analysis.sourceAsset,
    );
    const shots: Shot[] = [];
    for (const shot of analysis.shots) {
      const windows = Motion.windows(shot);
      const collected: MotionBeat[] = [];
      const motionWindows: MotionWindowState[] = [];
      const observedTimes = new Set<number>();
      let firstVisual: z.infer<typeof visualSchema> | undefined;
      let requests = 0;
      for (const window of windows) {
        const continuity = motionWindows.at(-1);
        const frameLimit = continuity ? 32 : 33;
        const turns = speech.turns.filter(
          (t) => t.start < window.end && t.end > window.start,
        );
        let times = Motion.addFineSamples(
          Motion.frameTimes(window, analysis.media.fps),
          Motion.rapidRanges(window, scores),
          analysis.media.fps,
          frameLimit,
        );
        const context = {
          source: analysis.sourceHash,
          shot: {
            id: shot.id,
            start: shot.start,
            end: shot.end,
            description: shot.description,
          },
          window,
          turns,
          speakers,
          previous: collected.slice(-4),
          continuity,
          baseUrl,
          model: connection.model,
          version: 3,
        };
        const request = async (stage: string, refinement?: MotionBeat[]) => {
          const id = `motion-v3-${signature({ ...context, times, stage, refinement })}`;
          const cached = await cacheGet<{
            visual: z.infer<typeof visualSchema>;
          }>(id);
          requests++;
          if (cached) return visualSchema.parse(cached.visual);
          const content = await Motion.content(
            analysis.sourceHash,
            analysis.sourceAsset,
            times,
            this.prompt(
              shot,
              window,
              speakers,
              turns,
              collected,
              refinement,
              continuity,
            ),
            continuity
              ? { time: continuity.frameTime, asset: continuity.frameAsset }
              : undefined,
          );
          const visual = visualSchema.parse(
            await chatJson(connection, content),
          );
          if (
            new Set(visual.speakers.map((s) => s.id)).size !==
            visual.speakers.length
          )
            throw new Error(
              "The model returned duplicate actor IDs. Retry analysis.",
            );
          // Validate evidence bounds before caching an otherwise well-formed response.
          Motion.beats(visual.motionBeats, times, window, {
            shotStart: shot.start,
            previous: collected.at(-1),
            endingSettled: visual.endingState?.settled,
          });
          await saveRecord("cache", { id, visual });
          return visual;
        };
        let visual = await request("initial");
        let beats = Motion.beats(visual.motionBeats, times, window, {
          shotStart: shot.start,
          previous: collected.at(-1),
          endingSettled: visual.endingState?.settled,
        });
        const fineTimes = Motion.addFineSamples(
          times,
          Motion.refinementRanges(beats, window),
          analysis.media.fps,
          frameLimit,
        );
        if (fineTimes.length > times.length) {
          times = fineTimes;
          visual = await request("refinement", beats);
          beats = Motion.beats(visual.motionBeats, times, window, {
            shotStart: shot.start,
            previous: collected.at(-1),
            endingSettled: visual.endingState?.settled,
          });
        }
        if (!firstVisual) firstVisual = visual;
        if (!motionOnly)
          for (const actor of visual.speakers)
            if (!speakers.some((s) => s.id === actor.id)) speakers.push(actor);
        for (const time of times) observedTimes.add(time);
        for (const beat of beats) {
          beat.evidence = await Motion.evidence(
            analysis.sourceHash,
            analysis.sourceAsset,
            beat,
          );
          if (beat.importance === "KEY")
            beat.frameAsset = await Motion.frame(
              analysis.sourceHash,
              analysis.sourceAsset,
              beat.anchorTime,
            );
          if (!collected.some((b) => b.id === beat.id)) collected.push(beat);
        }
        motionWindows.push({
          ...window,
          state: visual.endingState || {
            pose: "Unspecified",
            hands: "Unspecified",
            objects: "Unspecified",
            ongoingAction: beats.at(-1)?.action || "Unknown",
            settled: false,
          },
          frameTime: times.at(-1)!,
          frameAsset: await Motion.frame(
            analysis.sourceHash,
            analysis.sourceAsset,
            times.at(-1)!,
          ),
        });
      }
      const reviewed = shot.motionBeats?.filter((b) => b.reviewed) || [];
      const beats = [
        ...reviewed,
        ...collected.filter(
          (b) =>
            !reviewed.some(
              (r) =>
                r.phase === b.phase && r.start <= b.end && r.end >= b.start,
            ),
        ),
      ].sort((a, b) => a.start - b.start);
      const times = [...observedTimes].sort((a, b) => a - b);
      shots.push({
        ...shot,
        ...(!motionOnly && firstVisual
          ? {
              description: firstVisual.description,
              camera: firstVisual.camera,
              lighting: firstVisual.lighting,
            }
          : {}),
        motion:
          Motion.format(beats) ||
          "No visible state transition was identified in the sampled frames. Review the source.",
        motionBeats: beats,
        motionWindows,
        motionSampling: {
          version: 3,
          times,
          windows: windows.length,
          requests,
          maxGap: Motion.maxGap(times),
        },
      });
    }
    const warnings = [
      ...analysis.warnings.filter(
        (w) =>
          !w.startsWith("OpenAI analyzed up to 8") &&
          !w.startsWith("Motion timing:"),
      ),
      "Motion timing: activity spans and onset uncertainty are separate. Motion between snapshots is inferred; before/after evidence and human review determine trust. Continuation windows preserve the previous pose/object state. Refine older timelines to upgrade their timing labels.",
    ];
    if (!warnings.some((w) => w.startsWith("Transcription and speaker")))
      warnings.push(
        "Transcription and speaker attribution require review. Local Whisper does not identify speakers or vocal emotion.",
      );
    if (
      !motionOnly &&
      analysis.media.hasAudio &&
      !speech.turns.length &&
      connection.transcription === "MANUAL"
    )
      warnings.push(
        "Manual/no-dialogue mode: audio was not transcribed. Leave dialogue empty for a visual meme, or enter spoken words manually.",
      );
    return saveRecord("analyses", {
      ...analysis,
      ...(motionOnly ? {} : speech),
      speakers,
      shots,
      status: "ANALYZED",
      provider: "OPENAI_9ROUTER",
      model: connection.model,
      revision: analysis.revision + 1,
      warnings,
    });
  }
}
