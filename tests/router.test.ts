import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { GET, POST } from "../app/api/studio/route";
import { resolveRouterConnection } from "../app/lib/studio/server/connection";
import path from "node:path";
import {
  defaultConnection,
  type RouterConnection,
} from "../app/lib/studio/connection";
import {
  chatJson,
  routerBaseUrl,
  routerModels,
} from "../app/lib/studio/server/openai";
import {
  assetPath,
  newAsset,
  getRecord,
  state,
  saveRecord,
} from "../app/lib/studio/server/store";
import { run } from "../app/lib/studio/server/ffmpeg";
import type { Analysis } from "../app/lib/studio/types";
import { newVersion, type MotionBeat } from "../app/lib/studio/types";
import { VideoAnalysisService } from "../app/lib/studio/services/VideoAnalysisService";
import { OpenAIAnalysisProvider } from "../app/lib/studio/services/OpenAIAnalysisProvider";
import { SpeakerDiarizationService } from "../app/lib/studio/services/SpeakerDiarizationService";
import {
  OpenAIImageProvider,
  KeyframeService,
} from "../app/lib/studio/services/KeyframeService";

const testRoot = path.resolve(`.studio-test-${randomUUID()}`);
process.env.STUDIO_DATA_DIR = testRoot;
type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
) => void;
let handler: Handler;
let connection: RouterConnection;
let analysis: Analysis;
const requests: { url: string; body: string; auth?: string }[] = [];
const handlerErrors: unknown[] = [];
const server = createServer(async (req, res) => {
  const buffers: Buffer[] = [];
  for await (const chunk of req) buffers.push(Buffer.from(chunk));
  const body = Buffer.concat(buffers).toString();
  requests.push({ url: req.url || "", body, auth: req.headers.authorization });
  try {
    handler(req, res, body);
  } catch (error) {
    handlerErrors.push(error);
    res.writeHead(500);
    res.end("Test handler assertion failed");
  }
});
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const visual = {
  description: "An actor at left",
  camera: "Static wide shot",
  motion: "0.000s: visible pose",
  motionBeats: [],
  lighting: "Soft",
  speakers: [{ id: "actor_1", name: "Actor 1", description: "At left" }],
};
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  connection = {
    ...defaultConnection(),
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "router-test-secret",
    model: "cx/test-vision",
    transcription: "MANUAL",
  };
  const file = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=30:d=2",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file.path,
  ]);
  analysis = await VideoAnalysisService.inspect(file.asset, "source.mp4");
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(testRoot, { recursive: true, force: true });
  assert.equal(handlerErrors.length, 0, String(handlerErrors[0] || ""));
});

test("environment router credentials override stale browser settings and never appear in API state", async () => {
  const names = [
    "NINE_ROUTER_BASE_URL",
    "NINE_ROUTER_API_KEY",
    "NINE_ROUTER_MODEL",
  ] as const;
  const saved = names.map((name) => process.env[name]);
  try {
    process.env.NINE_ROUTER_BASE_URL = connection.baseUrl;
    process.env.NINE_ROUTER_API_KEY = "server-only-test-secret";
    process.env.NINE_ROUTER_MODEL = "cx/env-vision";
    const browser = {
      ...connection,
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "stale-browser-key",
      model: "stale-model",
    };
    const resolved = resolveRouterConnection(browser);
    assert.equal(resolved.apiKey, "server-only-test-secret");
    assert.equal(resolved.baseUrl, connection.baseUrl);
    assert.equal(resolved.model, "cx/env-vision");
    const response = await GET(new Request("http://localhost:3000/api/studio"));
    const body = await response.json();
    assert.equal(body.routerSettings.serverKeyConfigured, true);
    assert.equal(body.routerSettings.model, "cx/env-vision");
    assert.equal(body.routerSettings.apiKey, undefined);
    assert.ok(!JSON.stringify(body).includes("server-only-test-secret"));
    handler = (_req, res) => json(res, { data: [{ id: "cx/env-vision" }] });
    const form = new FormData();
    form.set("action", "models");
    form.set("payload", JSON.stringify({ connection: browser }));
    const listed = await POST(
      new Request("http://localhost:3000/api/studio", {
        method: "POST",
        body: form,
      }),
    );
    assert.equal(listed.status, 200);
    const result = await listed.json();
    assert.deepEqual(result.models, ["cx/env-vision"]);
    assert.equal(requests.at(-1)?.auth, "Bearer server-only-test-secret");
    assert.ok(!JSON.stringify(result).includes("server-only-test-secret"));
    for (const name of names) process.env[name] = "";
    assert.deepEqual(resolveRouterConnection(browser), browser);
  } finally {
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

test("9router model discovery forwards only the router key and validates loopback URLs", async () => {
  handler = (_req, res) =>
    json(res, {
      data: [
        { id: "cx/test-vision" },
        { id: "cx/test-vision" },
        { id: "cx/test-image" },
      ],
    });
  assert.deepEqual(await routerModels(connection), [
    "cx/test-image",
    "cx/test-vision",
  ]);
  assert.equal(requests.at(-1)?.url, "/v1/models");
  assert.equal(requests.at(-1)?.auth, "Bearer router-test-secret");
  for (const url of [
    "https://example.com/v1",
    "http://localhost:2@evil.test/v1",
    "file:///tmp",
    "http://127.0.0.1/v1?secret=key",
  ])
    assert.throws(() => routerBaseUrl(url));
});

test("9router errors hide upstream keys and media; truncated/refused JSON is rejected", async () => {
  handler = (_req, res) =>
    json(res, { error: { message: "router-test-secret private media" } }, 401);
  await assert.rejects(
    () => routerModels(connection),
    (e: Error) =>
      !e.message.includes("router-test-secret") && /401/.test(e.message),
  );
  handler = (_req, res) =>
    json(res, {
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
    });
  await assert.rejects(
    () => chatJson(connection, [{ type: "text", text: "test" }]),
    /did not complete/,
  );
  handler = (_req, res) =>
    json(res, {
      choices: [{ finish_reason: "stop", message: { content: "not JSON" } }],
    });
  await assert.rejects(
    () => chatJson(connection, [{ type: "text", text: "test" }]),
    /valid analysis JSON/,
  );
});

test("OpenAI visual analysis uses timestamped frames, preserves corrections/cuts, and resumes cached shots", async () => {
  let calls = 0;
  let failSecond = true;
  const originalTurns = [
    {
      id: "line1",
      speakerId: "manual_actor",
      start: 0.1,
      end: 1.2,
      text: "Putang ina, ready na?",
      emotion: "shouting",
      gesture: "",
      reviewed: true,
    },
  ];
  const corrected: Analysis = {
    ...analysis,
    speakers: [
      {
        id: "manual_actor",
        name: "Corrected speaker",
        description: "Verified manually",
      },
    ],
    turns: originalTurns,
  };
  handler = (req, res, raw) => {
    assert.equal(req.url, "/v1/chat/completions");
    const body = JSON.parse(raw);
    assert.equal(body.model, connection.model);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    const content = body.messages[0].content;
    assert.ok(
      content.some(
        (c: { type: string; image_url?: { url: string } }) =>
          c.type === "image_url" &&
          c.image_url!.url.startsWith("data:image/jpeg;base64,"),
      ),
    );
    if (body.messages[0].content[0].text.includes("Source interval 0-"))
      assert.ok(raw.includes("Putang ina, ready na?"));
    assert.ok(!raw.includes("video/mp4"));
    calls++;
    if (calls === 2 && failSecond) {
      json(res, { error: "temporary" }, 429);
      return;
    }
    json(res, {
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(visual) } },
      ],
    });
  };
  await assert.rejects(
    () => VideoAnalysisService.analyze(corrected, connection),
    /429/,
  );
  assert.equal(
    (await getRecord<Analysis>("analyses", analysis.id)).status,
    "LOCAL",
  );
  failSecond = false;
  const result = await VideoAnalysisService.analyze(corrected, connection);
  assert.equal(calls, 3); // First shot reused, second retried.
  assert.equal(result.provider, "OPENAI_9ROUTER");
  assert.deepEqual(result.turns, originalTurns);
  assert.deepEqual(
    result.shots.map((s) => [s.id, s.start, s.end]),
    corrected.shots.map((s) => [s.id, s.start, s.end]),
  );
  assert.equal(
    result.speakers.find((s) => s.id === "manual_actor")?.name,
    "Corrected speaker",
  );
  await VideoAnalysisService.analyze(result, {
    ...connection,
    model: "different",
  });
  assert.equal(calls, 3);
  assert.ok(!JSON.stringify(await state()).includes("router-test-secret"));
  for (const shot of analysis.shots) {
    const times = OpenAIAnalysisProvider.frameTimes(shot, 30);
    assert.ok(
      times.length <= 8 && times.every((t) => t >= shot.start && t < shot.end),
    );
  }
});

test("source context is saved independently, changes analysis caching, and reports evidence conflicts", async () => {
  const version = newVersion(randomUUID());
  const project = {
    id: randomUUID(),
    name: "Context test",
    analysisId: analysis.id,
    versions: [version],
    updatedAt: new Date().toISOString(),
  };
  await saveRecord("projects", project);
  const save = async (value: string) => {
    const form = new FormData();
    form.set("action", "save_source_context");
    form.set(
      "payload",
      JSON.stringify({ projectId: project.id, versionId: version.id, value }),
    );
    return POST(
      new Request("http://localhost:3000/api/studio", {
        method: "POST",
        body: form,
      }),
    );
  };
  const requestsBefore = requests.length;
  assert.equal((await save("x".repeat(4001))).status, 400);
  assert.equal(
    (await save("  A dance challenge with a red-to-blue cut.  ")).status,
    200,
  );
  const saved = await getRecord<Analysis>("analyses", analysis.id);
  assert.equal(
    saved.sourceContext,
    "A dance challenge with a red-to-blue cut.",
  );
  assert.equal(requests.length, requestsBefore);
  const contextConnection = { ...connection, model: "cx/context-test" };
  let calls = 0;
  handler = (_req, res, raw) => {
    calls++;
    const prompt = JSON.parse(raw).messages[0].content[0].text;
    assert.match(prompt, /SOURCE CONTEXT:/);
    assert.match(prompt, /unverified context/);
    assert.match(
      prompt,
      /Never invent events or assign timestamps from the description/,
    );
    assert.ok(
      prompt.includes(
        calls <= saved.shots.length
          ? saved.sourceContext!
          : "An object changes color.",
      ),
    );
    json(res, {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              ...visual,
              contextNotes: [
                "The supplied frames do not confirm a dance challenge.",
              ],
            }),
          },
        },
      ],
    });
  };
  const first = await VideoAnalysisService.analyze(
    { ...analysis, sourceContext: saved.sourceContext },
    contextConnection,
  );
  assert.equal(first.analyzedSourceContext, saved.sourceContext);
  assert.ok(
    first.warnings.includes(
      "Source context review: The supplied frames do not confirm a dance challenge.",
    ),
  );
  const initialCalls = calls;
  await VideoAnalysisService.analyze(first, contextConnection);
  assert.equal(calls, initialCalls);
  const changed = await VideoAnalysisService.analyze(
    {
      ...first,
      shots: analysis.shots,
      sourceContext: "An object changes color.",
    },
    contextConnection,
  );
  assert.equal(calls, initialCalls + saved.shots.length);
  assert.equal(changed.analyzedSourceContext, "An object changes color.");
  assert.deepEqual(changed.turns, first.turns);
  assert.equal(changed.revision, first.revision + 1);
});

test("motion-only refinement reuses partial results, keeps transcript/actors/reviewed beats and invalidates stale exports", async () => {
  const preserved: MotionBeat = {
    id: "human-beat",
    start: 3,
    end: 3.5,
    action: "Human corrected recovery",
    phase: "RECOVERY",
    importance: "KEY",
    confidence: "HIGH",
    evidenceTimes: [3, 3.5],
    anchorTime: 3.5,
    reviewed: true,
  };
  const saved: Analysis = {
    ...analysis,
    id: randomUUID(),
    status: "ANALYZED",
    media: { ...analysis.media, hasAudio: true },
    turns: [],
    speakers: [
      {
        id: "manual_actor",
        name: "User verified actor",
        description: "Saved description",
      },
    ],
    shots: [
      {
        ...analysis.shots[0],
        end: analysis.media.duration,
        description: "User verified scene",
        motion: "old coarse motion",
        motionBeats: [preserved],
      },
    ],
  };
  await saveRecord("analyses", saved);
  const version = {
    ...newVersion("refine-version"),
    exportAsset: analysis.sourceAsset,
    exportSignature: "old",
  };
  const project = {
    id: "refine-project",
    name: "Refine",
    analysisId: saved.id,
    versions: [version],
    updatedAt: "now",
  };
  await saveRecord("projects", project);
  let calls = 0,
    initialImages = 0;
  handler = (req, res, raw) => {
    assert.equal(req.url, "/v1/chat/completions"); // Must never call Whisper/STT, including for empty meme transcripts.
    const content = JSON.parse(raw).messages[0].content;
    const images = content.filter(
      (c: { type: string }) => c.type === "image_url",
    ).length;
    const refinement = content[0].text.includes("REFINEMENT PASS");
    calls++;
    if (calls === 1) {
      initialImages = images;
      assert.equal(refinement, false);
    } else {
      assert.equal(refinement, true);
      assert.ok(images > initialImages && images <= 33);
    }
    if (calls === 2) {
      json(res, { error: "retry" }, 429);
      return;
    }
    json(res, {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              ...visual,
              description: "Provider must not overwrite the corrected scene",
              speakers: [
                { id: "new_wrong_actor", name: "Wrong", description: "Ignore" },
              ],
              motionBeats: [
                {
                  start: 0.5,
                  end: refinement ? 0.75 : 1,
                  anchorTime: refinement ? 0.75 : 1,
                  action: "Initiating action",
                  timingKind: "TRANSITION",
                  onset: { start: 0.5, end: refinement ? 0.75 : 1 },
                  stateBefore: "Object upright",
                  stateAfter: "Object tilting",
                  phase: "ACTION",
                  importance: "KEY",
                  confidence: "MEDIUM",
                },
              ],
            }),
          },
        },
      ],
    });
  };
  const refine = async () => {
    const form = new FormData();
    form.set("action", "refine_motion");
    form.set(
      "payload",
      JSON.stringify({
        projectId: project.id,
        versionId: version.id,
        connection: { ...connection, transcription: "LOCAL" },
      }),
    );
    return POST(
      new Request("http://localhost:3000/api/studio", {
        method: "POST",
        body: form,
      }),
    );
  };
  assert.equal((await refine()).status, 400);
  assert.equal(
    (await getRecord<Analysis>("analyses", saved.id)).revision,
    saved.revision,
  );
  const response = await refine();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(calls, 3); // The initial model pass is cached across the failed refinement.
  const result = await response.json();
  const updated = result.analyses.find(
    (a: Analysis) => a.id === saved.id,
  ) as Analysis;
  assert.deepEqual(updated.turns, saved.turns);
  assert.deepEqual(updated.speakers, saved.speakers);
  assert.equal(updated.shots[0].description, "User verified scene");
  assert.deepEqual(
    updated.shots[0].motionBeats!.find((b) => b.id === preserved.id),
    preserved,
  );
  const refined = updated.shots[0].motionBeats!.find(
    (b) => b.action === "Initiating action",
  )!;
  assert.equal(refined.end, 0.75);
  assert.ok(refined.frameAsset);
  assert.ok(updated.shots[0].motionSampling!.times.includes(0.75));
  assert.ok(updated.shots[0].motionSampling!.maxGap <= 0.500001);
  assert.equal(
    result.projects.find((p: { id: string }) => p.id === project.id).versions[0]
      .exportAsset,
    undefined,
  );
});

test("later analysis windows receive prior pose imagery and state without restarting setup", async () => {
  const file = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x90:r=8:d=10.8333",
    "-vf",
    "drawbox=x=20:y=20:w=30:h=20:color=white:t=fill:enable='between(t,8,9)'",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file.path,
  ]);
  const inspected = await VideoAnalysisService.inspect(
    file.asset,
    "continuous.mp4",
  );
  let calls = 0;
  const state = {
    pose: "Leaning screen-right",
    hands: "Spoon hand extended; free hand near rim",
    objects: "Tilted, unstable prop",
    ongoingAction: "Attempting to intervene",
    settled: false,
  };
  handler = (req, res, raw) => {
    assert.equal(req.url, "/v1/chat/completions");
    const content = JSON.parse(raw).messages[0].content;
    const later = content[0].text.includes("Source interval 8-");
    assert.ok(
      content.filter((c: { type: string }) => c.type === "image_url").length <=
        33,
    );
    if (later) {
      assert.match(content[0].text, /Do not output SETUP/);
      assert.match(content[0].text, /Spoon hand extended/);
      assert.ok(
        content.some((c: { text?: string }) =>
          c.text?.includes("Continuity context BEFORE this window"),
        ),
      );
    }
    calls++;
    json(res, {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              ...visual,
              endingState: later
                ? {
                    ...state,
                    objects: "Prop supported and stable",
                    settled: true,
                  }
                : state,
              motionBeats: later
                ? [
                    {
                      start: 8,
                      end: 8.5,
                      anchorTime: 8,
                      action: "Hands remain extended",
                      phase: "SETUP",
                      importance: "NORMAL",
                      confidence: "HIGH",
                      timingKind: "ACTIVITY",
                      onset: null,
                      stateBefore: "Hands extended",
                      stateAfter: "Hands still extended",
                    },
                    {
                      start: 8.5,
                      end: 9,
                      anchorTime: 9,
                      action: "Attempted intervention during failure",
                      phase: "RECOVERY",
                      importance: "KEY",
                      confidence: "HIGH",
                      timingKind: "ACTIVITY",
                      onset: null,
                      settled: false,
                      stateBefore: "Prop unstable",
                      stateAfter: "Prop still falling",
                    },
                    {
                      start: 9.5,
                      end: 10.5,
                      anchorTime: 10.5,
                      action: "Prop stabilized",
                      phase: "RECOVERY",
                      importance: "NORMAL",
                      confidence: "HIGH",
                      timingKind: "ACTIVITY",
                      onset: null,
                      settled: true,
                      stateBefore: "Prop supported",
                      stateAfter: "Prop stable; hands still",
                    },
                  ]
                : [
                    {
                      start: 6,
                      end: 7.875,
                      anchorTime: 7.875,
                      action: "Attempting intervention",
                      phase: "ACTION",
                      importance: "KEY",
                      confidence: "HIGH",
                      timingKind: "ACTIVITY",
                      onset: null,
                      stateBefore: "Hands near prop",
                      stateAfter: "Spoon hand extended",
                    },
                  ],
            }),
          },
        },
      ],
    });
  };
  const result = await VideoAnalysisService.analyze(inspected, connection);
  assert.equal(calls, 2);
  const shot = result.shots[0];
  assert.equal(shot.motionSampling?.version, 3);
  assert.equal(shot.motionWindows?.length, 2);
  const continued = shot.motionBeats!.find(
    (b) => b.action === "Hands remain extended",
  )!;
  assert.equal(continued.phase, "ACTION");
  assert.equal(continued.continuing, true);
  assert.equal(continued.onset, undefined);
  assert.equal(
    shot.motionBeats!.find(
      (b) => b.action === "Attempted intervention during failure",
    )?.phase,
    "ACTION",
  );
  assert.equal(
    shot.motionBeats!.find((b) => b.action === "Prop stabilized")?.phase,
    "RECOVERY",
  );
  assert.ok(
    shot.motionBeats!.every((b) => b.confidence !== "HIGH" && !b.reviewed),
  );
  const proof = continued.evidence!;
  assert.ok((await readFile(assetPath(proof.before.asset))).length > 0);
  assert.ok((await readFile(assetPath(proof.after.asset))).length > 0);
});

test("Whisper transcripts preserve words, identify unlabeled speech honestly, and reject missing timestamps", () => {
  const speech = SpeakerDiarizationService.parseTranscript(
    {
      segments: [
        { start: 0.1, end: 1, text: "Putang ina, ready na?" },
        { start: 1.2, end: 2, text: "Yes, tara!" },
      ],
    },
    4,
  );
  assert.equal(speech.turns[0].text, "Putang ina, ready na?");
  assert.equal(speech.speakers.length, 1);
  assert.match(speech.speakers[0].description, /no speaker diarization/);
  assert.ok(speech.turns.every((t) => !t.reviewed));
  assert.throws(() =>
    SpeakerDiarizationService.parseTranscript({ text: "No timestamps" }, 4),
  );
  assert.throws(() =>
    SpeakerDiarizationService.parseTranscript(
      { segments: [{ start: 3, end: 5, text: "bad" }] },
      4,
    ),
  );
});

test("new transcription retains manually entered actors without assigning them unverified speech", async () => {
  const source = await newAsset("mp4");
  await run("ffmpeg", [
    "-y",
    "-i",
    assetPath(analysis.sourceAsset),
    "-f",
    "lavfi",
    "-i",
    "sine=duration=4",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    source.path,
  ]);
  const inspected = await VideoAnalysisService.inspect(
    source.asset,
    "with-audio.mp4",
  );
  const corrected = {
    ...inspected,
    speakers: [
      {
        id: "speaker_1",
        name: "User labeled actor",
        description: "Verified manually",
      },
    ],
  };
  handler = (req, res) => {
    if (req.url === "/v1/audio/transcriptions")
      json(res, {
        segments: [{ start: 0.1, end: 1, text: "Kumusta, ready na?" }],
      });
    else
      json(res, {
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(visual) },
          },
        ],
      });
  };
  const result = await VideoAnalysisService.analyze(corrected, {
    ...connection,
    transcription: "ROUTER",
    transcriptionModel: "test/whisper",
  });
  assert.equal(
    result.speakers.find((s) => s.id === "speaker_1")?.name,
    "User labeled actor",
  );
  assert.notEqual(result.turns[0].speakerId, "speaker_1");
  assert.equal(
    result.speakers.find((s) => s.id === result.turns[0].speakerId)?.name,
    "Unassigned speaker",
  );
});

test("missing Python produces actionable setup instructions and a manual transcript alternative", async () => {
  const previous = process.env.STUDIO_PYTHON;
  process.env.STUDIO_PYTHON = path.join(testRoot, "missing-python-executable");
  try {
    await assert.rejects(
      () => SpeakerDiarizationService.localTranscription("unused.wav", "auto"),
      /Install Python and faster-whisper.*manual transcript mode/,
    );
  } finally {
    if (previous === undefined) delete process.env.STUDIO_PYTHON;
    else process.env.STUDIO_PYTHON = previous;
  }
});

test("optional router transcription sends multipart audio and keeps supplied speaker labels", async () => {
  const audio = await newAsset("wav");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=1",
    audio.path,
  ]);
  handler = (req, res, body) => {
    assert.equal(req.url, "/v1/audio/transcriptions");
    assert.match(req.headers["content-type"]!, /multipart\/form-data/);
    assert.ok(body.includes("verbose_json"));
    assert.ok(body.includes("timestamp_granularities[]"));
    json(res, {
      segments: [{ start: 0.1, end: 0.8, speaker: "A", text: "Kumusta!" }],
    });
  };
  const result = await SpeakerDiarizationService.transcribe(
    analysis,
    audio.asset,
    {
      ...connection,
      transcription: "ROUTER",
      transcriptionModel: "test/whisper",
      language: "tl",
    },
  );
  assert.equal(result.turns[0].text, "Kumusta!");
  assert.equal(result.speakers[0].name, "Speaker A");
});

test("9router Codex image adapter sends source and identity images in order and validates returned PNG", async () => {
  const frames = await KeyframeService.extract(analysis, {
    id: "segment",
    shotId: analysis.shots[0].id,
    start: 0,
    end: 2,
    duration: 4,
    overlap: 0,
    strategy: "FRAMES",
    credits: 0,
    warnings: [],
  });
  const png = await readFile(assetPath(frames.first));
  handler = (req, res, raw) => {
    assert.equal(req.url, "/v1/images/generations");
    const body = JSON.parse(raw);
    assert.equal(body.images.length, 2);
    assert.equal(body.model, "cx/test-image");
    assert.equal(
      body.images[0],
      `data:image/png;base64,${png.toString("base64")}`,
    );
    assert.ok(body.prompt.includes("Image 2: Character identity"));
    json(res, { data: [{ b64_json: png.toString("base64") }] });
  };
  const provider = new OpenAIImageProvider();
  const input = {
    source: frames.first,
    references: [{ asset: frames.last, description: "Character identity" }],
    prompt: "Preserve composition",
    model: "cx/test-image",
    connection: { ...connection, imagesEnabled: true },
  };
  const generated = await provider.replace(input);
  assert.deepEqual(await readFile(assetPath(generated)), png);
  await assert.rejects(
    () => provider.replace({ ...input, connection }),
    /Enable/,
  );
  handler = (_req, res) => json(res, { data: [{ b64_json: "invalid" }] });
  await assert.rejects(() => provider.replace(input), /invalid/);
});
