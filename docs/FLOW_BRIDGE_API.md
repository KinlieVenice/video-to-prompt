# Experimental local Flow bridge

This branch has a local JSON API and **Flow workspace → Local Flow bridge** controls. It requires a dedicated signed-in Chrome process. It does **not** provide browserless Google login or a 9router-style OAuth connection inside Recast. Normal Chrome windows use a separate profile.

REA supplied investigation evidence. The application uses Playwright Core for browser interaction and file uploads, which REA 6.7.0's scenario runner does not support. References: [CDP connection](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp), [uploads](https://playwright.dev/docs/input#upload-files). Captured verification tokens and authorization headers are not replayed.

## Start and sign in

```powershell
# From the repository root; Chrome must be installed.
./scripts/flow/start-inspection-browser.ps1 -Visible
# Sign into Google Flow in that window and open a project.
npm run dev
```

Keep that Chrome process running. If it is already open, use **Check Flow connection** in Recast instead of starting a second copy. The default browser endpoint is `http://127.0.0.1:9223`; override it with server-side `FLOW_CDP_ENDPOINT`. There is no Google API key to put in `.env.local`. Sign-in stays in the ignored `.tmp/flow-rea-browser-9223/` profile. Normal 9router settings still handle analysis and image generation independently.

1. Save the version, plan segments and generate replacement reference images.
2. Open **Local Flow bridge**, check the connection, and use its project or enter a Flow project URL.
3. Select resolution and a segment. Model, aspect, strategy and duration come from the saved version/plan.
4. **Prepare selected segment** uploads references, selects controls, fills the prompt and reads the live quote. It does not submit generation.
5. Review the settings, references, prompt and quote. **Generate one clip · N credits** submits one output, with N as the maximum allowed cost. The server checks that the draft and quote still match.
6. **Refresh status**, then **Download original result**. Optionally request **Upscale to 720p · free only**, refresh and download it. **Use … in this segment** attaches the saved MP4 for assembly.

Avoid editing the Flow draft between preparation and submission. If it changes, dismiss local tracking and prepare again. **Prepare another take** explicitly creates another draft; ordinary preparation otherwise reuses matching jobs.

## Controls

- First frame and first/last frames use Frames mode and generated replacement references.
- Ingredients attaches the generated first image and mapped character references. It can select one saved Flow voice by name and apply performance instructions.
- Voice references require Omni Ingredients and a visual reference; they cannot be combined with Start/End frames. Multi-character TTS remains in the existing audio engine.
- Omni: 360p/720p, portrait/landscape, 4/6/8/10 seconds. The inspected Veo Lite interface exposes 720p/8 seconds. Unsupported settings fail rather than silently change the model or duration.
- Extension and reusable 2D strategies remain in the manual workflow. The bridge never submits video-to-video editing.
- Free upscale requires fresh model data confirming zero cost plus the matching enabled menu option. Existing matching upscales are reused. Unknown pricing stops submission.
- Keep **Original** audio for the source song. Use **Audio studio → Generated clip audio** to preserve voices, music and effects in imported clips. Original remains the default.

The adapter depends on current English Flow controls and observed response schemas. A changed interface, expired login or verification challenge can stop a job. Complete required sign-in/verification in Chrome; the bridge does not bypass it.

## HTTP API

The default app port is 3000. Requests are local-only; cross-origin browser requests are rejected. This is a job API, not an OpenAI-compatible endpoint.

`GET /api/studio/flow` returns `{ connection, jobs }`. Add `?jobsOnly=1` to read stored jobs without connecting to Chrome.

`POST /api/studio/flow` accepts JSON and returns `{ job }`. Errors return `{ error }` with HTTP 400. Prepare a Recast segment:

```json
{
  "action": "prepare",
  "projectId": "<local-project-id>",
  "versionId": "<version-id>",
  "segmentId": "<segment-id>",
  "settings": {
    "projectUrl": "https://flow.google.com/project/<flow-project-id>",
    "resolution": "360p",
    "voiceName": "",
    "voiceStyle": ""
  }
}
```

Leave `projectUrl` empty to use the open project. Alternatively supply `input` with `prompt`, `model` (`OMNI_FLASH`/`VEO_LITE`), `mode` (`FRAMES`/`FIRST_LAST`/`INGREDIENTS`), `duration`, `aspect`, optional `first`/`last` image asset IDs, `references`, and `settings`. Images must already exist in Recast's asset store; arbitrary paths and external image URLs are rejected. Standalone jobs have no automatic segment binding.

| Action     | Additional fields                  | Behavior                                                    |
| ---------- | ---------------------------------- | ----------------------------------------------------------- |
| `submit`   | `jobId`, `maxCredits`              | Submit only a matching prepared draft within its live quote |
| `refresh`  | `jobId`                            | Read generation/upscale status                              |
| `download` | `jobId`, optional `upscaled: true` | Save completed MP4 and verify dimensions/duration           |
| `upscale`  | `jobId`                            | Request/reuse free Omni 360p→720p upscale                   |
| `import`   | `jobId`, optional `upscaled: true` | Attach saved video to its still-current bound segment       |
| `dismiss`  | `jobId`                            | Stop local tracking; does not cancel work in Flow           |

Preparation accepts `newAttempt: true` after completion. Repeated submit requests return the stored job rather than click Generate again.

## Persistence and recovery

Jobs live in `.studio/flow-jobs/`, videos in `.studio/assets/`. Source analysis and characters stay reusable. Changed source/cast/prompt/references prevent stale submission or import, while completed files remain saved. Requests share the studio's serialized write queue.

Submission intent is saved before the browser click. Interrupted or ambiguous submissions become `UNKNOWN`, with no automatic paid retry. Inspect Flow before dismissing an unknown job. Generation and upscale have separate states; upscale failure preserves the original download.

Some cached CDP responses expose empty bodies. The server then retrieves the exact `flow-content.google` URL just observed in the owned browser, without copying cookies or authorization headers. Temporary URLs are not persisted or returned as public links; callers receive local asset IDs.

## Verification

The earlier authorized browser test generated one 360p clip for 4 credits and upscaled it for 0 additional credits. During implementation, no-credit live smoke tests verified the new API's first/last uploads and prepared quote, Ingredients-plus-voice preparation, status retrieval, and downloads of those existing results. The adapter's charged submission path has not been exercised with a fresh paid generation. Automated tests cover credit bounds, duplicates, interrupted state, HTTP restrictions, parsing, export audio and workspace review/submit/import with fake providers.

See [API charges](API_CHARGES.md) and the [REA investigation](FLOW_REA_BRIDGE.md) for evidence and live-test limits.
