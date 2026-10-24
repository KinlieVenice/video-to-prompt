# AI Video Reenactment Studio · RE/CAST

A local-first, character-agnostic extension of [imooooc/video-to-prompt](https://github.com/imooooc/video-to-prompt). Analyze a reference once, reuse any character cast, prepare manual Google Flow generations, and assemble the result locally with FFmpeg.

## Run locally

New uploads use the [guided upload-to-final-video workflow](docs/GUIDED_WORKFLOW.md): choose cast/audio, skip optional background settings, then generate and assemble automatically. Edit `STUDIO_DEFAULT_*` in `.env.local` to change defaults; `.env.example` lists every setting. Dedicated signed-in Flow Chrome is required for automatic video generation. Advanced workspace retains the manual tools.

Node.js 22+ is recommended. Use the committed npm lockfile:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. The development and production scripts bind to the loopback interface. This app needs a local Node server and writable disk; it is no longer a browser-only/static export.

See [`.env.example`](.env.example) for Whisper, model-cache, storage and FFmpeg settings. Copy it to `.env.local` for a new setup, then restart the server. Keep an existing `.env.local` when the machine is already configured. Put your 9router key in `.env.local` as `NINE_ROUTER_API_KEY=your_key_here`. Set `NINE_ROUTER_BASE_URL=http://127.0.0.1:20128/v1` and optionally `NINE_ROUTER_MODEL=your_tested_model_id`. Non-empty environment values override browser settings; the environment key stays on the server.

FFmpeg and FFprobe binaries are installed by `ffmpeg-static` and `ffprobe-static`. If your platform requires system binaries, set `FFMPEG_PATH` and `FFPROBE_PATH` to their absolute paths before starting. FFmpeg must include `libx264`, AAC, and `libass` for visible disclosure. The default packaged Windows binaries are exercised by the integration tests.

This branch uses **OpenAI through your existing 9router instance**. Open **API & model settings**, enter `http://127.0.0.1:20128/v1` (or your local router URL), set its router key in `.env.local` (or enter a browser-local key in Settings), and click **Connect & load models**. Select or paste your tested vision-capable OpenAI model ID including its provider prefix. Model discovery does not prove image/audio entitlements; the studio never automatically picks a different model or switches to a paid provider. Configure any router-side fallback policy in 9router itself.

Connect the ChatGPT account inside 9router; do not paste a ChatGPT session token or your old Gemini key into this app. Keys and model settings use a separate browser storage entry, so old Gemini credentials are not forwarded to 9router. See [setup](docs/9ROUTER_SETUP.md) and [separate usage costs](docs/API_CHARGES.md).

## Local transcription

Python 3.10+ is needed only for local Whisper. Install into the Python environment used by the server:

```sh
python -m pip install -r scripts/requirements-whisper.txt
```

The default multilingual `small` model runs on CPU with int8 quantization. Its first use downloads model weights. Set `STUDIO_PYTHON` to an absolute Python executable path if needed. `STUDIO_WHISPER_MODEL`, `STUDIO_WHISPER_DEVICE` and `STUDIO_WHISPER_COMPUTE_TYPE` override those defaults. Restart the server after changing environment variables. Use **Keep / enter transcript manually** in Settings to work without Python or a model download.

Local Whisper provides timestamped speech segments, **not speaker diarization**. Unlabeled segments use an explicit ?Unassigned speaker? placeholder; split turns and map speakers manually. Overlaps, Filipino/Taglish accuracy and vocal emotion need listening review. Existing corrected transcripts are preserved rather than retranscribed.

## Workflow

1. **Source & analysis:** upload MP4/MOV (up to 512MB and 10 minutes). FFmpeg finds hard cuts and audio activity. Run local Whisper for timestamped transcription and OpenAI through 9router for motion analysis in eight-second windows, sampled every 0.5 seconds with targeted 0.25-second refinement. Or select manual/no-dialogue transcript mode. Use **Refine motion timing** on a saved analysis to upgrade the motion draft while preserving its transcript and actors. Review separate activity spans/onset uncertainty, before/after evidence, ongoing action and settled recovery. Correct dialogue, speakers, cuts and motion beats; sampled images cannot replace full video/audio understanding.
2. **Character library:** create reusable profiles with descriptions, visual styles, reference images and saved voices. Map original actors to replacements. Duplicate a project version for another cast without repeating analysis.
3. **Audio studio:** keep **ORIGINAL** audio by default, generate each **CHARACTER_TTS** turn with its saved OpenAI voice through an explicitly enabled 9router speech route, use an **UPLOADED** recording, or choose **SILENT**. Preview/regenerate saved takes and adjust offsets/speed without changing the words. Upload an externally separated background stem if needed.
4. **Flow workspace:** choose Veo 3.1 Lite or Gemini Omni Flash, duration and strategy. Plan along shot boundaries, extract first/last frames, optionally generate replacements through a reference-capable 9router Codex image route, copy prompts or download a ZIP with prompts and references. Generate clips manually in Google Flow, then import them into their matching segments.
5. **Assemble & export:** adjust clip trims and audio sync, choose 16:9 or 9:16, optionally add subtitles and disclosure, assemble with FFmpeg, preview and download MP4.

The MVP supports frames-to-video, first/last frame, ingredient/reference and continuous-shot Veo Lite extension plans. Reusable 2D animation is an external render/import fallback. It implements no video-to-video editing and no undocumented Flow automation.

In **Source & analysis → Reenactment range**, set a source start/end and click **Apply range** to reenact only that interval (for example, 0–10 seconds). The range is saved per version; analysis and camera cuts still cover the full original. Planning, cost estimates, audio and captions use the selected interval, with export starting at zero. ORIGINAL audio keeps the matching portion of the source song. Uploaded recordings/background stems align to the full source timeline before trimming. Changing range requires replanning, which resets that version's frame/clip assignments while retaining files on disk.

**Split shot** adds a camera boundary without trimming the video. **Undo split** restores the timeline before an unsaved split; **Remove cut at …** merges adjacent shots, including saved cuts. Click **Save transcript & timeline** to persist these corrections. Rejoined motion beats are deduplicated before validation.

## Saved work

The `feat/flow-rea-bridge` branch includes an [experimental local Flow API](docs/FLOW_BRIDGE_API.md) and workspace controls for preparing reference uploads, reviewing live quotes, submitting one output, tracking jobs, downloading/upscaling and importing results. It requires a dedicated signed-in Chrome process, started with `./scripts/flow/start-inspection-browser.ps1 -Visible`; it does not offer browserless login inside Recast. Use **Generated clip audio** in Audio studio to retain native Flow voices, or keep **Original** for the source song. The [REA investigation](docs/FLOW_REA_BRIDGE.md) records the verified contracts and remaining live-test limits. The manual workflow remains available.

Flow cards show generated replacement frames in their main slots. Before generation, these slots stay empty and display **NOT GENERATED**. **Extract original frames** saves source footage images, accessible under **Source frame references · original cast**; it does not replace the cast. The workspace shows how many segment pairs have been generated. Original video previews and key-pose evidence retain the source actors. Generate each segment's replacement frames before downloading them for the chosen cast.

In **Character library**, each detected actor's replacement assignment has **Optional appearance for this assignment**. Enter changes such as “wear glasses and have diamonds on the teeth,” then click **Save cast & appearance**. Notes apply only to that actor in that version, including when two actors use the same saved profile. They are included in image editing, Flow prompts, cache keys and package manifests. They override conflicting source/reference accessory or clothing details while retaining the chosen identity and natural mouth/action timing. Clearing an assignment clears its notes. Saved character profiles, voices, source analysis and audio stay reusable; changed appearance requires new reference frames and clips.

In **Flow workspace → Scene & performance**, choose **Match source background** to preserve the source setting, or **Create a new background** and describe its setting/colors/lighting. The selected character identities, camera framing, choreography and action props remain the same. Choose **Match source expressions**, **Slightly more expressive**, or **More expressive**; the expression instructions preserve emotional meaning, speech mouth timing and action order. New versions default to slight expression emphasis. Existing versions without these settings retain their prior source-matching behavior.

Enable **Complete cropped or padded areas** for the image model to infer coherent scene geometry from the full reference and source context, then continue truncated objects/surfaces into artificial black bars or blank canvas. For example, a cropped lectern can continue into the empty lower part of the frame. The rules are general; no character or object is hardcoded. Genuine dark scene content should remain intact. Select **Generation aspect ratio** before generating: completion fits the source into that canvas without cropping it, then asks image generation to fill missing areas. The completed first frame also anchors the last frame's geometry. This option is on for new versions and off for older saved versions; disable it with source background/expression matching to retain the original crop and borders. Missing details are inferred, not recovered from unseen footage.

Click **Save scene & expression**, generate replacement first/last frames, and use the updated prompts in Flow. New-background last frames receive the generated first frame as an environment reference, without adding a third image request. Continuous segments can still reuse a matching prior last frame. Settings are per version and included in Flow packages. Saving a changed look clears that version's generated frame/clip assignments while retaining original frames, analysis, plan and audio. Duplicate a version before trying another look. These are generation instructions; inspect the images and clips for fidelity to the source.

Projects, source analyses and characters live separately in `.studio/`, with binary assets and hash-based reuse caches. Back up that entire folder to preserve projects and media. Change the location with `STUDIO_DATA_DIR` before launching.

9router settings can come from `.env.local` or browser settings. The environment key stays server-side; a browser-local key is forwarded only for provider actions. Neither key is written to projects, caches or exported packages. OpenAI visual analysis sends sampled frames and transcript context through 9router. Local Whisper keeps audio on this machine; optional router transcription sends audio to the selected upstream provider. There is no AI request on upload or planning. Each explicit analysis action processes uncached shots sequentially. Existing completed Gemini analyses, character profiles and generated assets remain readable without rerunning analysis; Gemini voice IDs are not converted into OpenAI voices automatically.

Shared profiles affect linked versions when edited; create another character profile for a preserved alternate identity or voice. Source analysis is shared by identical source bytes, and its corrections affect every linked project. Generated audio and images remain saved for reuse. Replanning replaces this version's frame/clip assignments, while the media files remain on disk.

## Validation and limits

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

The media integration tests use real synthetic footage and FFmpeg. Provider responses are mocked, so tests make no paid API calls. Browser tests build the production app, then start it on port 3100 with a separate `.tmp/` data directory; they can run alongside the default development server. They need an installed Chromium; run `npx playwright install chromium` if your machine has none.

Review AI dialogue and actor labels before TTS. Scene scores and silence detection are timing evidence, not guaranteed word alignment. Generated mouth movements require manual review. Original mode preserves the recorded performance and encodes the output soundtrack as AAC. Subtitles are optional MP4 text tracks; disclosure is visible. Automatic source separation, forced phoneme alignment, lip-sync repair and a built-in 2D rig engine are not part of the MVP.

- [Motion timing, refinement and key-pose references](docs/MOTION_ANALYSIS.md)
- [Phase deliverables and verification](docs/PHASES.md)
- [Service architecture, storage and timing behavior](docs/ARCHITECTURE.md)
- [OpenAI / 9router usage vs Flow credits](docs/API_CHARGES.md)

MIT. Original project attribution and license retained.
