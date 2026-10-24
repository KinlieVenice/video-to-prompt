import { randomUUID } from "node:crypto";
import { guidedVersion } from "../../lib/studio/guided";
import { guidedDefaults } from "../../lib/studio/server/guidedDefaults";
import { z } from "zod";
import { stat } from "node:fs/promises";
import {
  newVersion,
  type Analysis,
  type Character,
  type Project,
  type Version,
} from "../../lib/studio/types";
import { connectionSchema } from "../../lib/studio/connection";
import { reenactmentRange } from "../../lib/studio/range";
import { visualDirectionChanged } from "../../lib/studio/visualDirection";
import {
  appearanceChanged,
  appearanceNotes,
} from "../../lib/studio/appearance";
import {
  resolveRouterConnection,
  publicRouterSettings,
} from "../../lib/studio/server/connection";
import { routerModels } from "../../lib/studio/server/openai";
import {
  analysisEditSchema,
  characterSchema,
  sourceContextSchema,
  validateTimeline,
  versionEditSchema,
} from "../../lib/studio/validation";
import {
  assetPath,
  exclusive,
  getRecord,
  saveRecord,
  state,
  writeAsset,
} from "../../lib/studio/server/store";
import { localRequest } from "../../lib/studio/server/http";
import { binary, probe, probeImage } from "../../lib/studio/server/ffmpeg";
import { VideoAnalysisService } from "../../lib/studio/services/VideoAnalysisService";
import { MotionAnalysisService } from "../../lib/studio/services/MotionAnalysisService";
import { CharacterService } from "../../lib/studio/services/CharacterService";
import { VoiceService } from "../../lib/studio/services/VoiceService";
import { ScenePlannerService } from "../../lib/studio/services/ScenePlannerService";
import { KeyframeService } from "../../lib/studio/services/KeyframeService";
import { PromptGenerationService } from "../../lib/studio/services/PromptGenerationService";
import { VideoAssemblyService } from "../../lib/studio/services/VideoAssemblyService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const payloadSchema = z.object({
  projectId: identifier.optional(),
  versionId: identifier.optional(),
  characterId: identifier.optional(),
  segmentId: identifier.optional(),
  turnId: identifier.optional(),
  analysisId: identifier.optional(),
  connection: connectionSchema.optional(),
  model: z.string().trim().max(200).optional(),
  value: z.unknown().optional(),
  regenerate: z.boolean().optional(),
  guided: z.boolean().optional(),
  name: z.string().max(200).optional(),
  sourceContext: sourceContextSchema.optional(),
  role: z.enum(["uploadedAudio", "backgroundAudio"]).optional(),
});
function fail(error: unknown) {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : error instanceof Error
        ? error.message
        : "Studio operation failed.";
  return Response.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(request: Request) {
  try {
    localRequest(request);
    const ffmpegReady = await stat(binary("ffmpeg")).then(
      () => true,
      () => false,
    );
    const ffprobeReady = await stat(binary("ffprobe")).then(
      () => true,
      () => false,
    );
    return Response.json(
      {
        ...(await state()),
        ffmpegReady: ffmpegReady && ffprobeReady,
        routerSettings: publicRouterSettings(),
        guidedDefaults: guidedDefaults(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    localRequest(request);
    const limit = 512 * 1024 * 1024;
    if (Number(request.headers.get("content-length") || 0) > limit + 1_000_000)
      throw new Error("Upload limit is 512 MB.");
    const form = await request.formData();
    const action = String(form.get("action") || "");
    const p = payloadSchema.parse(
      JSON.parse(String(form.get("payload") || "{}")),
    );
    return await exclusive(async () => {
      const snapshot = await state();
      let project: Project | undefined = p.projectId
        ? await getRecord<Project>("projects", p.projectId)
        : undefined;
      let version: Version | undefined = project?.versions.find(
        (v) => v.id === p.versionId,
      );
      const analysis = project
        ? await getRecord<Analysis>("analyses", project.analysisId)
        : undefined;
      const needVersion = () => {
        if (!project || !version || !analysis)
          throw new Error("Select an existing project and version.");
        return { project, version, analysis };
      };
      const needSegment = () => {
        const ctx = needVersion();
        if (ctx.version.planRevision !== ctx.analysis.revision)
          throw new Error("Replan segments after editing the source analysis.");
        const segment = ctx.version.segments.find((s) => s.id === p.segmentId);
        if (!segment) throw new Error("Select a planned segment.");
        return { ...ctx, segment };
      };
      const upload = async (extensions: string[], max = limit) => {
        const file = form.get("file");
        if (!(file instanceof File) || !file.size)
          throw new Error("Choose a file to upload.");
        const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
        const ext = extension === "jpeg" ? "jpg" : extension;
        if (!extensions.includes(ext) || file.size > max)
          throw new Error(
            `Choose ${extensions.join(" / ")} within ${Math.round(max / 1024 / 1024)} MB.`,
          );
        return {
          asset: await writeAsset(Buffer.from(await file.arrayBuffer()), ext),
          name: file.name,
        };
      };
      const invalidateCharacter = async (
        characterId: string,
        visuals: boolean,
      ) => {
        for (const saved of snapshot.projects) {
          let changed = false;
          for (const v of saved.versions.filter((v) =>
            Object.values(v.mappings).includes(characterId),
          )) {
            v.exportAsset = undefined;
            v.exportSignature = undefined;
            changed = true;
            if (visuals) {
              v.clips = {};
              Object.values(v.frames).forEach((f) => {
                f.generated = undefined;
              });
            }
          }
          if (changed) {
            await saveRecord("projects", saved);
            if (saved.id === project?.id) {
              project = saved;
              version = saved.versions.find((v) => v.id === p.versionId);
            }
          }
        }
      };
      let result: Record<string, unknown> = {};
      switch (action) {
        case "models": {
          result = {
            models: await routerModels(resolveRouterConnection(p.connection)),
          };
          break;
        }
        case "create_project": {
          const uploaded = await upload(["mp4", "mov"]);
          const inspected = await VideoAnalysisService.inspect(
            uploaded.asset,
            uploaded.name,
          );
          project = {
            id: randomUUID(),
            name: uploaded.name.replace(/\.[^.]+$/, ""),
            analysisId: inspected.id,
            versions: [
              p.guided
                ? guidedVersion(randomUUID(), guidedDefaults())
                : newVersion(randomUUID()),
            ],
            updatedAt: new Date().toISOString(),
          };
          result = { projectId: project.id };
          break;
        }
        case "save_source_context": {
          const ctx = needVersion();
          await saveRecord("analyses", {
            ...ctx.analysis,
            sourceContext: sourceContextSchema.parse(p.value),
          });
          break;
        }
        case "analyze":
        case "refine_motion": {
          const ctx = needVersion();
          const input =
            p.sourceContext === undefined
              ? ctx.analysis
              : await saveRecord("analyses", {
                  ...ctx.analysis,
                  sourceContext: p.sourceContext,
                });
          const updated = await VideoAnalysisService.analyze(
            input,
            resolveRouterConnection(p.connection),
            action === "refine_motion",
          );
          if (updated.revision !== ctx.analysis.revision) {
            for (const saved of snapshot.projects.filter(
              (item) => item.analysisId === ctx.analysis.id,
            )) {
              saved.versions.forEach((v) => {
                v.exportAsset = undefined;
                v.exportSignature = undefined;
              });
              await saveRecord("projects", saved);
              if (saved.id === project?.id) {
                project = saved;
                version = saved.versions.find((v) => v.id === p.versionId);
              }
            }
          }
          break;
        }
        case "save_analysis": {
          const ctx = needVersion();
          const edited = validateTimeline(
            analysisEditSchema.parse(p.value),
            ctx.analysis.media.duration,
          );
          for (const shot of edited.shots)
            for (const beat of shot.motionBeats || [])
              if (
                beat.timingKind &&
                (!beat.evidence ||
                  beat.evidence.before.time !==
                    (beat.onset?.start ?? beat.start) ||
                  beat.evidence.after.time !== (beat.onset?.end ?? beat.end))
              )
                beat.evidence = await MotionAnalysisService.evidence(
                  ctx.analysis.sourceHash,
                  ctx.analysis.sourceAsset,
                  beat,
                  {
                    start: shot.start,
                    end: shot.end,
                    fps: ctx.analysis.media.fps,
                  },
                );
          for (const shot of edited.shots)
            for (const beat of shot.motionBeats || [])
              if (beat.evidence)
                beat.evidenceTimes = [
                  ...new Set([
                    ...beat.evidenceTimes,
                    beat.evidence.before.time,
                    beat.evidence.after.time,
                  ]),
                ].sort((a, b) => a - b);
          await saveRecord("analyses", {
            ...ctx.analysis,
            ...edited,
            revision: ctx.analysis.revision + 1,
          });
          for (const other of snapshot.projects.filter(
            (x) => x.analysisId === ctx.analysis.id && x.id !== project!.id,
          )) {
            other.versions.forEach((v) => {
              v.exportAsset = undefined;
              v.exportSignature = undefined;
            });
            await saveRecord("projects", other);
          }
          project!.versions.forEach((v) => {
            v.exportAsset = undefined;
            v.exportSignature = undefined;
          });
          break;
        }
        case "save_character": {
          const parsed = characterSchema.parse(p.value);
          const old = snapshot.characters.find((c) => c.id === parsed.id);
          await CharacterService.save(parsed);
          const identityChanged =
            old &&
            JSON.stringify([
              old.name,
              old.description,
              old.visualStyle,
              old.references,
            ]) !==
              JSON.stringify([
                parsed.name,
                parsed.description,
                parsed.visualStyle,
                parsed.references,
              ]);
          const voiceChanged =
            old &&
            JSON.stringify({
              ...old.voice,
              previewAsset: undefined,
              designPrompt: undefined,
            }) !==
              JSON.stringify({
                ...parsed.voice,
                previewAsset: undefined,
                designPrompt: undefined,
              });
          if (identityChanged || voiceChanged)
            await invalidateCharacter(parsed.id, Boolean(identityChanged));
          break;
        }
        case "upload_reference": {
          if (!p.characterId) throw new Error("Save the character first.");
          const character = await getRecord<Character>(
            "characters",
            p.characterId,
          );
          if (character.references.length >= 12)
            throw new Error("Maximum 12 reference images per character.");
          const uploaded = await upload(
            ["png", "jpg", "webp"],
            12 * 1024 * 1024,
          );
          const image = await probeImage(assetPath(uploaded.asset));
          const expected = uploaded.asset.endsWith(".jpg")
            ? "mjpeg"
            : uploaded.asset.split(".").at(-1);
          if (image.codec_name !== expected)
            throw new Error(
              "Reference image bytes do not match its file extension.",
            );
          await CharacterService.save({
            ...character,
            references: [...character.references, uploaded.asset],
          });
          await invalidateCharacter(character.id, true);
          break;
        }
        case "save_version": {
          const ctx = needVersion(),
            edited = versionEditSchema.parse(p.value);
          const selected = reenactmentRange(ctx.analysis, {
            sourceRange: edited.sourceRange ?? ctx.version.sourceRange,
          });
          const oldRange = reenactmentRange(ctx.analysis, ctx.version);
          const rangeChanged =
            selected.start !== oldRange.start || selected.end !== oldRange.end;
          for (const [speakerId, characterId] of Object.entries(
            edited.mappings,
          )) {
            if (
              !ctx.analysis.speakers.some((s) => s.id === speakerId) ||
              !snapshot.characters.some((c) => c.id === characterId)
            )
              throw new Error(
                "Character mapping refers to a missing actor or character.",
              );
          }
          const notes = appearanceNotes({ ...ctx.version, ...edited });
          for (const actorId of Object.keys(notes)) {
            if (
              !ctx.analysis.speakers.some(
                (speaker) => speaker.id === actorId,
              ) ||
              !edited.mappings[actorId]
            )
              throw new Error(
                "Assign a saved replacement character before adding appearance notes for this actor.",
              );
          }
          const planChanged = [
            "target",
            "maxDuration",
            "overlap",
            "strategy",
            "ultra",
            "creditOverride",
          ].some(
            (key) =>
              JSON.stringify(ctx.version[key as keyof Version]) !==
              JSON.stringify(edited[key as keyof typeof edited]),
          );
          const castChanged =
            JSON.stringify(edited.mappings) !==
            JSON.stringify(ctx.version.mappings);
          const updatedSettings = {
            ...ctx.version,
            ...edited,
            appearanceNotes: notes,
          };
          const visualsChanged =
            visualDirectionChanged(ctx.version, updatedSettings) ||
            appearanceChanged(ctx.version, updatedSettings);
          const aspectChanged = ctx.version.aspect !== edited.aspect;
          Object.assign(ctx.version, edited, { appearanceNotes: notes });
          if (planChanged || rangeChanged) ctx.version.planRevision = undefined;
          if (castChanged || visualsChanged) ctx.version.clips = {};
          if (castChanged || visualsChanged || aspectChanged) {
            Object.values(ctx.version.frames).forEach((f) => {
              f.generated = undefined;
            });
          }
          ctx.version.exportAsset = undefined;
          ctx.version.exportSignature = undefined;
          break;
        }
        case "duplicate_version": {
          const ctx = needVersion();
          const copy = structuredClone(ctx.version);
          copy.id = randomUUID();
          copy.name = p.name?.trim() || `${copy.name} copy`;
          project!.versions.push(copy);
          result = { versionId: copy.id };
          break;
        }
        case "plan": {
          const ctx = needVersion();
          ctx.version.segments = ScenePlannerService.plan(
            ctx.analysis,
            ctx.version,
          );
          ctx.version.planRevision = ctx.analysis.revision;
          ctx.version.frames = {};
          ctx.version.clips = {};
          ctx.version.exportAsset = undefined;
          ctx.version.exportSignature = undefined;
          break;
        }
        case "generate_line": {
          const ctx = needVersion();
          const turn = ctx.analysis.turns.find((t) => t.id === p.turnId);
          if (!turn) throw new Error("Dialogue line does not exist.");
          const character = snapshot.characters.find(
            (c) => c.id === ctx.version.mappings[turn.speakerId],
          );
          if (!character)
            throw new Error("Map this speaker to a saved character first.");
          const take = await VoiceService.generate(
            turn,
            character,
            resolveRouterConnection(p.connection),
            p.regenerate,
          );
          const takes = ctx.version.audioTakes[turn.id] || [];
          if (!takes.some((t) => t.asset === take.asset)) takes.push(take);
          ctx.version.audioTakes[turn.id] = takes;
          ctx.version.selectedTakes[turn.id] = take.asset;
          ctx.version.exportAsset = undefined;
          break;
        }
        case "select_take": {
          const ctx = needVersion();
          const asset = z.string().parse(p.value);
          if (
            !p.turnId ||
            !ctx.version.audioTakes[p.turnId]?.some((t) => t.asset === asset)
          )
            throw new Error("Audio take is not part of this version.");
          ctx.version.selectedTakes[p.turnId] = asset;
          ctx.version.exportAsset = undefined;
          break;
        }
        case "preview_voice": {
          const character = snapshot.characters.find(
            (c) => c.id === p.characterId,
          );
          if (!character) throw new Error("Save this character first.");
          const turn = {
            id: "preview",
            speakerId: "preview",
            start: 0,
            end: 20,
            text: p.name || "Kumusta! This is my voice. Ready na tayo.",
            emotion: "",
            gesture: "",
            reviewed: true,
          };
          const take = await VoiceService.generate(
            turn,
            character,
            resolveRouterConnection(p.connection),
          );
          await CharacterService.save({
            ...character,
            voice: { ...character.voice, previewAsset: take.asset },
          });
          break;
        }
        case "design_voice": {
          const character = snapshot.characters.find(
            (c) => c.id === p.characterId,
          );
          if (!character) throw new Error("Save this character first.");
          await CharacterService.save(await VoiceService.design());
          await invalidateCharacter(character.id, false);
          break;
        }
        case "upload_audio": {
          const ctx = needVersion();
          const uploaded = await upload(["wav", "mp3", "m4a", "flac", "ogg"]);
          if (!(await probe(assetPath(uploaded.asset))).hasAudio)
            throw new Error("Recording contains no audio.");
          ctx.version[p.role || "uploadedAudio"] = uploaded.asset;
          ctx.version.exportAsset = undefined;
          break;
        }
        case "extract_audio": {
          const ctx = needVersion();
          if (!ctx.analysis.media.hasAudio)
            throw new Error("Source has no audio.");
          result = {
            asset: await VoiceService.extractOriginal(ctx.analysis.sourceAsset),
          };
          break;
        }
        case "extract_frames": {
          const ctx = needSegment();
          const old = ctx.version.frames[ctx.segment.id];
          ctx.version.frames[ctx.segment.id] =
            old || (await KeyframeService.extract(ctx.analysis, ctx.segment));
          break;
        }
        case "generate_frames": {
          const ctx = needSegment();
          const frames =
            ctx.version.frames[ctx.segment.id] ||
            (await KeyframeService.extract(ctx.analysis, ctx.segment));
          ctx.version.frames[ctx.segment.id] =
            await new KeyframeService().generate(
              ctx.analysis,
              ctx.version,
              ctx.segment,
              frames,
              snapshot.characters,
              p.model || "cx/gpt-image-2",
              resolveRouterConnection(p.connection),
            );
          break;
        }
        case "import_clip": {
          const ctx = needSegment();
          const uploaded = await upload(["mp4", "mov"]);
          const media = await probe(assetPath(uploaded.asset));
          if (!media.width) throw new Error("Clip has no video stream.");
          if (media.duration <= ctx.segment.overlap + 0.001)
            throw new Error(
              "Clip ends before the planned overlap. Upload a longer clip or reduce the overlap.",
            );
          ctx.version.clips[ctx.segment.id] = {
            asset: uploaded.asset,
            media,
            trim: 0,
            sourceName: uploaded.name,
            importedAt: new Date().toISOString(),
          };
          ctx.version.exportAsset = undefined;
          ctx.version.exportSignature = undefined;
          break;
        }
        case "trim_clip": {
          const ctx = needSegment();
          const clip = ctx.version.clips[ctx.segment.id];
          if (!clip) throw new Error("Import this clip first.");
          const trim = z.number().min(0).max(600).parse(p.value);
          if (clip.media.duration - trim - ctx.segment.overlap <= 0.001)
            throw new Error(
              "Choose a trim before the clip ends, allowing for the planned overlap.",
            );
          clip.trim = trim;
          ctx.version.exportAsset = undefined;
          ctx.version.exportSignature = undefined;
          break;
        }
        case "assemble": {
          const ctx = needVersion();
          const output = await VideoAssemblyService.assemble(
            ctx.analysis,
            ctx.version,
            snapshot.characters,
          );
          ctx.version.exportAsset = output.asset;
          ctx.version.exportSignature = output.signature;
          break;
        }
        case "package": {
          const ctx = needVersion();
          if (
            ctx.version.planRevision !== ctx.analysis.revision ||
            !ctx.version.segments.length
          )
            throw new Error("Plan current segments first.");
          const prompts = Object.fromEntries(
            ctx.version.segments.map((s) => [
              s.id,
              PromptGenerationService.generate(
                ctx.analysis,
                ctx.version,
                s,
                snapshot.characters,
              ),
            ]),
          );
          result = {
            asset: await VideoAssemblyService.downloadPackage(
              ctx.project,
              ctx.analysis,
              ctx.version,
              snapshot.characters,
              prompts,
            ),
          };
          break;
        }
        default:
          throw new Error("Unknown studio action.");
      }
      if (project) {
        project.updatedAt = new Date().toISOString();
        await saveRecord("projects", project);
      }
      return Response.json(
        { ...(await state()), ...result },
        { headers: { "Cache-Control": "no-store" } },
      );
    });
  } catch (error) {
    return fail(error);
  }
}
