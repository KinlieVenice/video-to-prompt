import { after, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  flowInputSchema,
  flowCdpEndpoint,
  flowProjectUrl,
  creditQuote,
  rpcPayload,
  mediaState,
  acceptedMedia,
  freeUpscalePrice,
  type FlowInput,
} from "../app/lib/studio/flow";
import {
  FlowJobService,
  type FlowDriver,
} from "../app/lib/studio/services/FlowJobService";
import { saveRecord } from "../app/lib/studio/server/store";
import { GET, POST } from "../app/api/studio/flow/route";

const testRoot = path.resolve(".tmp", `flow-tests-${randomUUID()}`);
process.env.STUDIO_DATA_DIR = testRoot;
after(async () => {
  assert(testRoot.startsWith(path.resolve(".tmp") + path.sep));
  await rm(testRoot, { recursive: true, force: true });
});
const input = (prompt = randomUUID()): FlowInput => ({
  prompt,
  model: "OMNI_FLASH",
  mode: "INGREDIENTS",
  duration: 4,
  aspect: "9:16",
  references: [],
  settings: {
    projectUrl:
      "https://flow.google.com/project/11111111-1111-1111-1111-111111111111",
    resolution: "360p",
    voiceName: "",
    voiceStyle: "",
  },
});
function driver(overrides: Partial<FlowDriver> = {}): FlowDriver {
  return {
    prepare: async (value) => ({
      projectUrl: value.settings.projectUrl,
      quote: 4,
      draftSignature: "draft",
    }),
    submit: async (_job, _max, before) => {
      await before();
      return { mediaId: randomUUID() };
    },
    refresh: async () => "COMPLETE",
    download: async () => `${randomUUID()}.mp4`,
    upscale: async (_job, before) => {
      await before();
      return { mediaId: randomUUID() };
    },
    ...overrides,
  };
}
test("Flow connection and combination validation fails before browser activity", () => {
  assert.equal(flowCdpEndpoint(), "http://127.0.0.1:9223");
  for (const endpoint of [
    "https://127.0.0.1:9223",
    "http://example.com:9223",
    "http://localhost:9223/path",
    "http://user:secret@localhost:9223",
  ])
    assert.throws(() => flowCdpEndpoint(endpoint));
  assert.throws(() =>
    flowProjectUrl("https://flow.google.com.evil.test/project/x"),
  );
  assert.throws(() =>
    flowInputSchema.parse({ ...input(), mode: "FIRST_LAST" }),
  );
  assert.throws(() =>
    flowInputSchema.parse({
      ...input(),
      settings: { ...input().settings, voiceName: "Achird" },
    }),
  );
  assert.throws(() => flowInputSchema.parse({ ...input(), model: "VEO_LITE" }));
  assert.equal(creditQuote("4 credits"), 4);
  assert.equal(creditQuote("0 credits"), 0);
  assert.throws(() => creditQuote("Unknown credits"));
});
test("RPC decoding selects the requested method and leaves errors unresolved", () => {
  const body = `)]}'\n\n200\n${JSON.stringify([
    ["wrb.fr", "target", JSON.stringify([null, 12, [], [["media"]]])],
    ["wrb.fr", "other", "secret"],
  ])}\n`;
  assert.deepEqual(rpcPayload(body, "target"), [null, 12, [], [["media"]]]);
  assert.equal(rpcPayload(body, "missing"), undefined);
  assert.equal(rpcPayload('[ ["er","target",null] ]', "target"), undefined);
  assert.equal(mediaState(3), "COMPLETE");
  assert.equal(mediaState(7), "FAILED");
  assert.equal(mediaState(undefined), "RUNNING");
  assert.equal(
    freeUpscalePrice([
      [
        "omni_upsampler_360p",
        null,
        null,
        null,
        [
          [2, [[null, 0]]],
          [3, [[null, 0]]],
        ],
      ],
    ]),
    true,
  );
  assert.equal(
    freeUpscalePrice([
      [
        "omni_upsampler_360p",
        null,
        null,
        null,
        [
          [2, [[null, 1]]],
          [3, [[null, 0]]],
        ],
      ],
    ]),
    false,
  );
  assert.equal(freeUpscalePrice([["omni_upsampler_360p", 1]]), undefined);
  const projectId = "11111111-1111-1111-1111-111111111111",
    sceneId = "22222222-2222-2222-2222-222222222222";
  const accepted = acceptedMedia(
    [null, 12, [], [["media", projectId, sceneId]]],
    input().settings.projectUrl,
  );
  assert.deepEqual(accepted, { mediaId: "media", sceneId });
  assert.equal(
    acceptedMedia(
      [null, 12, [], [["media", "other-project", sceneId]]],
      input().settings.projectUrl,
    ),
    undefined,
  );
});
test("Local Flow endpoints reject cross-site calls and arbitrary file paths without opening Chrome", async () => {
  const forbidden = await GET(
    new Request("http://localhost:3000/api/studio/flow?jobsOnly=1", {
      headers: { origin: "https://other.example" },
    }),
  );
  assert.equal(forbidden.status, 400);
  const list = await GET(
    new Request("http://localhost:3000/api/studio/flow?jobsOnly=1"),
  );
  assert.equal(list.status, 200);
  assert(Array.isArray((await list.json()).jobs));
  const invalid = await POST(
    new Request("http://localhost:3000/api/studio/flow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "prepare",
        input: { ...input(), first: "../../secret.png" },
      }),
    }),
  );
  assert.equal(invalid.status, 400);
});
test("Flow jobs persist credit intent before submitting and deduplicate repeated clicks", async () => {
  let calls = 0;
  const service = new FlowJobService(
    driver({
      submit: async (job, max, before) => {
        calls++;
        assert.equal(max, 4);
        await before();
        assert.equal((await FlowJobService.get(job.id)).state, "SUBMITTING");
        return { mediaId: "remote-result" };
      },
    }),
  );
  const value = input();
  const prepared = await service.prepare(value);
  assert.equal(prepared.state, "PREPARED");
  await assert.rejects(service.submit(prepared.id, 3), /exceeds/);
  assert.equal(calls, 0);
  assert.equal((await service.submit(prepared.id, 4)).state, "RUNNING");
  await service.submit(prepared.id, 4);
  assert.equal(calls, 1);
  assert.equal((await service.refresh(prepared.id)).state, "COMPLETE");
  assert.equal((await service.prepare(value)).id, prepared.id);
  const another = await service.prepare(value, undefined, true);
  assert.notEqual(another.id, prepared.id);
  assert.equal((await service.prepare(value)).id, another.id);
  await service.dismiss(another.id);
});
test("An uncertain paid submission cannot be automatically retried or replaced", async () => {
  let calls = 0;
  const service = new FlowJobService(
    driver({
      submit: async (_job, _max, before) => {
        calls++;
        await before();
        throw Error("network lost");
      },
    }),
  );
  const job = await service.prepare(input());
  assert.equal((await service.submit(job.id, 4)).state, "UNKNOWN");
  await service.submit(job.id, 4);
  assert.equal(calls, 1);
  await assert.rejects(service.prepare(input()), /reconcile/);
  await service.dismiss(job.id);
});
test("Restart recovery flags interrupted submissions and upscale download retries reuse the result", async () => {
  let upscaleCalls = 0,
    downloads = 0;
  const service = new FlowJobService(
    driver({
      upscale: async (_job, before) => {
        upscaleCalls++;
        await before();
        return { mediaId: "upscaled-result" };
      },
      download: async () => {
        downloads++;
        return `${randomUUID()}.mp4`;
      },
    }),
  );
  const job = await service.prepare(input());
  await saveRecord("flow-jobs", { ...job, state: "SUBMITTING" });
  assert.equal((await service.refresh(job.id)).state, "UNKNOWN");
  await service.dismiss(job.id);
  const ready = await service.prepare(input());
  await service.submit(ready.id, 4);
  await service.refresh(ready.id);
  const base = await service.download(ready.id);
  await service.upscale(ready.id);
  await service.upscale(ready.id);
  assert.equal(upscaleCalls, 1);
  await service.refresh(ready.id);
  const upgraded = await service.download(ready.id, true);
  await service.download(ready.id, true);
  assert.equal(downloads, 2);
  assert.equal(upgraded.asset, base.asset);
  assert.notEqual(upgraded.upscale?.asset, base.asset);
});
