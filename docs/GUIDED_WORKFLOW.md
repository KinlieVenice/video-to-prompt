# Upload to assembled video

New guided uploads start source analysis through the configured 9router connection. Choose replacement characters and audio. **Original** keeps the source song/dialogue. Character TTS, an uploaded recording, silent output and generated clip audio remain available.

**Skip optional steps · use defaults** jumps to the generation summary. Alternatively continue to background/expression controls and skip remaining options there. Review the credit limit and press **Generate final MP4** once. Reference pairs, Flow submissions, status checks, downloads, clip assignments, audio and FFmpeg assembly then run automatically. The advanced workspace keeps the manual tools.

Keep Recast open, the local server running, and the dedicated Flow Chrome signed in with a project open. Closing Recast stops scheduling new steps; reopening guided setup restores the saved run. This is a sequence of local requests, not an installed background service. Google login remains in Chrome.

## Editable defaults

Edit `.env.local` in the repository root, then restart Next.js. `.env.example` documents every setting. New guided projects receive changed defaults; existing versions retain saved settings. The image model is selected from the current defaults when creating a run.

```dotenv
STUDIO_DEFAULT_FLOW_MODEL=OMNI_FLASH
STUDIO_DEFAULT_FLOW_RESOLUTION=360p
STUDIO_DEFAULT_MAX_DURATION=8
STUDIO_DEFAULT_STRATEGY=FIRST_LAST
STUDIO_DEFAULT_OVERLAP=0
STUDIO_DEFAULT_ASPECT=9:16
STUDIO_DEFAULT_EXPRESSION=EXPRESSIVE
STUDIO_DEFAULT_BACKGROUND_MODE=SOURCE
STUDIO_DEFAULT_BACKGROUND_PROMPT=
STUDIO_DEFAULT_COMPLETE_SCENE=true
STUDIO_DEFAULT_IMAGE_MODEL=cx/gpt-image-2.5-sunburst
STUDIO_DEFAULT_AUDIO_MODE=ORIGINAL
STUDIO_DEFAULT_CREDIT_OVERRIDE=
```

`OMNI_FLASH` means Omni 1.1 Flash. Alternatives include `VEO_LITE` (requires 720p/8 seconds), supported durations 4/6/8/10, strategies `FRAMES`/`FIRST_LAST`/`INGREDIENTS`, aspect `16:9`, expression `SUBTLE`/`MATCH_SOURCE`, background `NEW` with a nonempty prompt, completion `false`, and the existing audio modes. Blank credit override uses the planner baseline. Unsupported combinations fail explicitly. No character is hardcoded.

Scene completion preserves the background while extending truncated objects and artificial black padding into the selected canvas. Genuine dark scene content stays intact. Flow generation defaults to 360p; the existing FFmpeg assembler normalizes the final MP4 to 720p. This normalization is not a generative upscale. Free Flow upscale remains in the advanced workspace.

## Persistence, charges and recovery

Runs live in `.studio/runs/`, separate from reusable analysis, character records and Flow jobs. Router credentials remain request-only. Each advance performs at most one operation under the local write queue. Completed references, speech and matching Flow jobs are reused through their existing caches.

The final button authorizes reference images, selected speech requests and Flow submissions within the displayed total credit cap. The adapter checks the live account quote and reserves credits persistently before every submission. Image/TTS charges or quota remain separate from Flow credits. An ambiguous submission pauses without automatic resubmission; reconcile it in the advanced Flow workspace. Increasing the limit or retrying remaining work requires Resume. Failed native attempts remain counted conservatively against the run limit.

Source, character or settings changes pause an existing run before further work. Start a new run for changed choices; existing assets remain saved. Overlong TTS pauses for timing correction before video generation. Sign-in, missing provider routes, model failures and credit limits can require intervention. Mouth synchronization and output quality still need review.

The automatic path is tested with provider/browser doubles and an assembled-result handoff. Existing integration tests render real MP4s through FFmpeg. No Flow credits are spent on implementation tests; a fresh paid generation through this full automatic path has not been live-tested.

## Local API

`GET /api/studio/runs` lists saved runs. `POST /api/studio/runs` accepts JSON with `action`: `start` (`projectId`, `versionId`, `maxCredits`, optional `imageModel`, request-only `connection`), `advance` (`runId`, `connection`), `pause` (`runId`) or `resume` (`runId`, optional increased `maxCredits`). Responses return `{run}`. Local host/origin checks apply. The guided page schedules advance calls and displays the persisted final asset.
