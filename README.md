# AI Video Reenactment Studio · RE/CAST

A local-first, character-agnostic extension of [imooooc/video-to-prompt](https://github.com/imooooc/video-to-prompt). Analyze a reference once, reuse any character cast, prepare manual Google Flow generations, and assemble the result locally with FFmpeg.

## Run locally

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
