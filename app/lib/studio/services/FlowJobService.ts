import { randomUUID } from "node:crypto";
import type { FlowInput, FlowJob, FlowState } from "../flow";
import { flowInputSchema } from "../flow";
import { getRecord, listRecords, saveRecord, signature } from "../server/store";

// Keep the local job API independent of the eventual browser/session transport.
export interface FlowDriver {
  prepare(
    input: FlowInput,
  ): Promise<Pick<FlowJob, "projectUrl" | "quote" | "draftSignature">>;
  submit(
    job: FlowJob,
    maxCredits: number,
    beforeClick: () => Promise<void>,
  ): Promise<{ mediaId: string; sceneId?: string }>;
  refresh(job: FlowJob, upscaled: boolean): Promise<FlowState>;
  download(job: FlowJob, upscaled: boolean): Promise<string>;
  upscale(
    job: FlowJob,
    beforeClick: () => Promise<void>,
  ): Promise<{ mediaId: string }>;
}
const active = (state: FlowState) =>
  ["SUBMITTING", "RUNNING", "UNKNOWN"].includes(state);
export class FlowJobService {
  constructor(private driver: FlowDriver) {}
  static list() {
    return listRecords<FlowJob>("flow-jobs");
  }
  static get(id: string) {
    return getRecord<FlowJob>("flow-jobs", id);
  }
  private save(job: FlowJob) {
    job.updatedAt = new Date().toISOString();
    return saveRecord("flow-jobs", job);
  }
  async prepare(
    value: unknown,
    binding?: FlowJob["binding"],
    newAttempt = false,
  ) {
    const input = flowInputSchema.parse(value);
    const fingerprint = signature({ input, binding });
    const jobs = (await FlowJobService.list()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const existing = jobs.find(
      (j) =>
        j.fingerprint === fingerprint &&
        !["FAILED", "ABANDONED"].includes(j.state),
    );
    if (existing && !newAttempt) return existing;
    if (existing && newAttempt && existing.state !== "COMPLETE")
      throw new Error(
        "Finish or dismiss the existing draft before preparing another take.",
      );
    if (
      jobs.some(
        (j) => active(j.state) || (j.upscale && active(j.upscale.state)),
      )
    )
      throw new Error(
        "Finish or reconcile the active Flow job before preparing another generation.",
      );
    const now = new Date().toISOString();
    const job: FlowJob = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      fingerprint,
      input,
      binding,
      projectUrl: input.settings.projectUrl,
      state: "DRAFT",
    };
    await this.save(job);
    try {
      Object.assign(job, await this.driver.prepare(input));
      if (
        typeof job.quote !== "number" ||
        !Number.isFinite(job.quote) ||
        job.quote < 0 ||
        !job.draftSignature
      )
        throw new Error(
          "Flow did not return a complete draft and credit quote.",
        );
      job.state = "PREPARED";
    } catch (error) {
      job.state = "FAILED";
      job.error =
        error instanceof Error ? error.message : "Could not prepare Flow.";
    }
    return this.save(job);
  }
  async submit(id: string, maxCredits: number) {
    const job = await FlowJobService.get(id);
    // Idempotent after acceptance: repeated clicks never repeat a charged request.
    if (job.state !== "PREPARED") return job;
    const otherJobs = await FlowJobService.list();
    if (
      otherJobs.some(
        (other) =>
          other.id !== id &&
          (active(other.state) ||
            (other.upscale && active(other.upscale.state))),
      )
    )
      throw new Error(
        "Reconcile the other active Flow job before submitting this draft.",
      );
    if (
      !Number.isFinite(maxCredits) ||
      maxCredits < 0 ||
      job.quote === undefined ||
      job.quote > maxCredits
    )
      throw new Error("The Flow quote exceeds the allowed credit amount.");
    let intentSaved = false;
    try {
      const result = await this.driver.submit(job, maxCredits, async () => {
        job.state = "SUBMITTING";
        await this.save(job); // Persist before the irreversible browser action.
        intentSaved = true;
      });
      if (!intentSaved || !result.mediaId)
        throw new Error("Generation acceptance could not be verified.");
      Object.assign(job, result, { state: "RUNNING", error: undefined });
    } catch (error) {
      job.state = intentSaved ? "UNKNOWN" : "PREPARED";
      job.error = intentSaved
        ? "Submission outcome is uncertain. Inspect Flow before dismissing this job; it will not be submitted again automatically."
        : error instanceof Error
          ? error.message
          : "Flow draft validation failed.";
    }
    return this.save(job);
  }
  async refresh(id: string) {
    const job = await FlowJobService.get(id);
    if (job.state === "SUBMITTING") {
      job.state = "UNKNOWN";
      job.error =
        "The server stopped during submission. Inspect Flow; no automatic resubmission is allowed.";
    } else if (job.mediaId && ["RUNNING", "UNKNOWN"].includes(job.state)) {
      job.state = await this.driver.refresh(job, false);
    }
    if (job.upscale?.state === "SUBMITTING") {
      job.upscale.state = "UNKNOWN";
      job.upscale.error =
        "Upscale submission was interrupted. Inspect Flow before continuing.";
    } else if (
      job.upscale?.mediaId &&
      ["RUNNING", "UNKNOWN"].includes(job.upscale.state)
    ) {
      job.upscale.state = await this.driver.refresh(job, true);
    }
    return this.save(job);
  }
  async download(id: string, upscaled = false) {
    const job = await FlowJobService.get(id);
    const operation = upscaled ? job.upscale : job;
    if (!operation || operation.state !== "COMPLETE")
      throw new Error(
        "Wait for this Flow result to complete before downloading.",
      );
    if (!operation.asset)
      operation.asset = await this.driver.download(job, upscaled);
    return this.save(job);
  }
  async upscale(id: string) {
    const job = await FlowJobService.get(id);
    if (job.upscale) return job; // A download retry must not resubmit upscale.
    if (
      job.state !== "COMPLETE" ||
      job.input.settings.resolution !== "360p" ||
      job.input.model !== "OMNI_FLASH"
    )
      throw new Error(
        "Free 720p upscale requires a completed Omni 360p result.",
      );
    let intentSaved = false;
    try {
      const result = await this.driver.upscale(job, async () => {
        job.upscale = { state: "SUBMITTING" };
        await this.save(job);
        intentSaved = true;
      });
      if (!intentSaved || !result.mediaId)
        throw new Error("Upscale acceptance could not be verified.");
      job.upscale = { ...result, state: "RUNNING" };
    } catch (error) {
      if (intentSaved)
        job.upscale = {
          state: "UNKNOWN",
          error:
            "Upscale outcome is uncertain. Check Flow; it will not be submitted again automatically.",
        };
      else throw error;
    }
    return this.save(job);
  }
  async dismiss(id: string) {
    const job = await FlowJobService.get(id);
    if (job.state !== "COMPLETE") job.state = "ABANDONED";
    if (job.upscale && job.upscale.state !== "COMPLETE")
      job.upscale.state = "ABANDONED";
    job.error = "Local tracking dismissed. This does not cancel a job in Flow.";
    return this.save(job);
  }
}
