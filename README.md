# AI Video Reenactment Studio · RE/CAST

A local-first, character-agnostic extension of [imooooc/video-to-prompt](https://github.com/imooooc/video-to-prompt). Analyze a reference once, reuse any character cast, prepare manual Google Flow generations, and assemble the result locally with FFmpeg.

## Run locally

Node.js 22+ is recommended. Use the committed npm lockfile:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. The development and production scripts bind to the loopback interface. This app needs a local Node server and writable disk; it is no longer a browser-only/static export.

FFmpeg and FFprobe binaries are installed by `ffmpeg-static` and `ffprobe-static`. If your platform requires system binaries, set `FFMPEG_PATH` and `FFPROBE_PATH` to their absolute paths before starting. FFmpeg must include `libx264`, AAC, and `libass` for visible disclosure. The default packaged Windows binaries are exercised by the integration tests.

Add your own Gemini API key in **API & model settings** when you want AI analysis, TTS or replacement images. Upload/scanning, manual corrections, mapping, planning, frame extraction and assembly work without a key. See [API charges and official sources](docs/API_CHARGES.md) before making provider calls.

## Workflow

1. **Source & analysis:** upload MP4/MOV (up to 512MB and 10 minutes). FFmpeg finds hard cuts and audio activity. Run Gemini for a separate speaker transcript and visual performance analysis, then correct dialogue, speakers, cuts and motion beats.
2. **Character library:** create reusable profiles with descriptions, visual styles, reference images and saved voices. Map original actors to replacements. Duplicate a project version for another cast without repeating analysis.
3. **Audio studio:** keep **ORIGINAL** audio by default, generate each **CHARACTER_TTS** turn with its saved Gemini voice, use an **UPLOADED** recording, or choose **SILENT**. Preview/regenerate saved takes and adjust offsets/speed without changing the words. Upload an externally separated background stem if needed.
4. **Flow workspace:** choose Veo 3.1 Lite or Gemini Omni Flash, duration and strategy. Plan along shot boundaries, extract first/last frames, generate replacements, copy prompts or download a ZIP with prompts and references. Generate clips manually in Google Flow, then import them into their matching segments.
5. **Assemble & export:** adjust clip trims and audio sync, choose 16:9 or 9:16, optionally add subtitles and disclosure, assemble with FFmpeg, preview and download MP4.

The MVP supports frames-to-video, first/last frame, ingredient/reference and continuous-shot Veo Lite extension plans. Reusable 2D animation is an external render/import fallback. It implements no video-to-video editing and no undocumented Flow automation.

## Saved work

Projects, source analyses and characters live separately in `.studio/`, with binary assets and hash-based reuse caches. Back up that entire folder to preserve projects and media. Change the location with `STUDIO_DATA_DIR` before launching.

The Gemini key is browser-local and forwarded to the local server only for provider actions. It is not written to projects or exported packages. AI actions send their relevant inputs to Google. There is no paid request on upload or planning, and no automatic batch generation.

Shared profiles affect linked versions when edited; create another character profile for a preserved alternate identity or voice. Source analysis is shared by identical source bytes, and its corrections affect every linked project. Generated audio and images remain saved for reuse. Replanning replaces this version's frame/clip assignments, while the media files remain on disk.

## Validation and limits

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

The media integration tests use real synthetic footage and FFmpeg. Provider responses are mocked, so tests make no paid API calls. Browser tests use a separate `.tmp/` data directory and an installed Chromium; run `npx playwright install chromium` if your machine has none.

Review AI dialogue and actor labels before TTS. Scene scores and silence detection are timing evidence, not guaranteed word alignment. Generated mouth movements require manual review. Original mode preserves the recorded performance and encodes the output soundtrack as AAC. Subtitles are optional MP4 text tracks; disclosure is visible. Automatic source separation, forced phoneme alignment, lip-sync repair and a built-in 2D rig engine are not part of the MVP.

- [Phase deliverables and verification](docs/PHASES.md)
- [Service architecture, storage and timing behavior](docs/ARCHITECTURE.md)
- [Gemini API charges vs Flow credits](docs/API_CHARGES.md)

MIT. Original project attribution and license retained.
