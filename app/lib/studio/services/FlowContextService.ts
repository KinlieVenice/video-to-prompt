import { getRecord, listRecords, signature } from "../server/store";
import {
  flowInputSchema,
  flowSettingsSchema,
  type FlowJob,
  type FlowSettings,
} from "../flow";
import type { Analysis, Character, Project } from "../types";
import { referenceLinkCurrent } from "../references";
import { PromptGenerationService } from "./PromptGenerationService";

export type FlowConnection = {
  status(): Promise<{ projectUrl?: string; message: string }>;
};
export async function flowContext(
  browser: FlowConnection,
  projectId: string,
  versionId: string,
  segmentId: string,
  settings?: FlowSettings,
) {
  const project = await getRecord<Project>("projects", projectId);
  const version = project.versions.find((v) => v.id === versionId);
  const analysis = await getRecord<Analysis>("analyses", project.analysisId);
  const segment = version?.segments.find((s) => s.id === segmentId);
  if (!version || !segment || version.planRevision !== analysis.revision)
    throw new Error(
      "Select a current planned segment. Save changes and replan if needed.",
    );
  if (!["FRAMES", "FIRST_LAST", "INGREDIENTS"].includes(segment.strategy))
    throw new Error(
      "This bridge supports Frames, First + last and Ingredients. Use the manual workspace for other strategies.",
    );
  const characters = await listRecords<Character>("characters");
  if (!referenceLinkCurrent(version, segment))
    throw new Error(
      "The preceding reference changed. Regenerate this segment's references before preparing or importing Flow output.",
    );
  const frames = version.frames[segmentId]?.generated;
  const selected = flowSettingsSchema.parse(
    settings ||
      version.flowSettings || {
        resolution: version.target === "VEO_LITE" ? "720p" : "360p",
      },
  );
  if (!selected.projectUrl) {
    const connected = await browser.status();
    if (!connected.projectUrl) throw new Error(connected.message);
    selected.projectUrl = connected.projectUrl;
  }
  const input = flowInputSchema.parse({
    prompt: PromptGenerationService.generate(
      analysis,
      version,
      segment,
      characters,
      {
        resolution: selected.resolution,
        nativeVoice: Boolean(selected.voiceName),
      },
    ),
    model: version.target,
    mode: segment.strategy,
    duration: segment.duration,
    aspect: version.aspect,
    first: frames?.first,
    last: frames?.last,
    references: characters
      .filter((c) => Object.values(version.mappings).includes(c.id))
      .flatMap((c) => c.references)
      .slice(0, 6),
    settings: selected,
  });
  return {
    project,
    version,
    analysis,
    segment,
    input,
    binding: {
      projectId,
      versionId,
      segmentId,
      signature: signature({
        revision: analysis.revision,
        source: analysis.sourceHash,
        input,
      }),
    },
  };
}
export async function currentFlowContext(
  browser: FlowConnection,
  job: FlowJob,
) {
  if (!job.binding) return;
  const ctx = await flowContext(
    browser,
    job.binding.projectId,
    job.binding.versionId,
    job.binding.segmentId,
    job.input.settings,
  );
  if (ctx.binding.signature !== job.binding.signature)
    throw new Error(
      "This Flow job belongs to an older source, cast, prompt or reference set. Prepare a new job for the current version.",
    );
  return ctx;
}
