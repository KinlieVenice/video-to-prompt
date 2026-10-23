# OpenAI through 9router

This branch connects to your existing local 9router instance. It does not install 9router, sign into accounts, scrape ChatGPT, or automate Google Flow.

1. Start 9router and confirm your tested OpenAI account connection works there.
2. Start the studio with `npm run dev` and open `http://127.0.0.1:3000`.
3. Open **API & model settings**. Set **9router base URL** to `http://127.0.0.1:20128/v1`, or the local loopback URL your instance uses. Include `/v1`. Docker users must publish the router port to the host.
4. Put `NINE_ROUTER_API_KEY=your_key_here` in the project root `.env.local`, then restart the server. Also set `NINE_ROUTER_BASE_URL=http://127.0.0.1:20128/v1` and optionally `NINE_ROUTER_MODEL=your_tested_model_id`. Non-empty environment values override browser settings, including older saved values. The key stays on the server; Settings shows only that it is configured. A browser-local key can still be entered in Settings when no environment key is set. Use the key issued by 9router.
5. Click **Connect & load models**, then select/paste your tested vision-capable OpenAI route's full ID, including its provider prefix. No specific model or fallback is selected automatically. A successful model listing verifies the connection, not vision or media entitlements.
6. Choose the transcript workflow below and save. Upload a short video, then click **Analyze with OpenAI**. Only this explicit action sends the sampled frames and transcript context to the selected model.
7. Correct dialogue, actor identities, gestures and timestamps before mapping a replacement cast. Use **Refine motion timing** to upgrade a saved coarse analysis; this never reruns transcription. Review the evidence-backed beat ranges and key-pose images in the timeline editor. Generate clips manually in Google Flow, import them, and assemble locally as before.

The default router URL is local-only. Remote hosts and credential-bearing URLs are rejected. The studio runs on the same machine as 9router or its published Docker port.

## Transcript workflows

**Local Whisper (default):** install Python 3.10+ and run:

```sh
python -m pip install -r scripts/requirements-whisper.txt
```

The requirements file pins faster-whisper and constrains PyAV below version 19, which removes an API used by faster-whisper 1.2.1.

The first transcription downloads the multilingual `small` weights; subsequent runs reuse the local model cache. It uses CPU/int8 by default. To use an isolated environment on Windows:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r scripts/requirements-whisper.txt
$env:STUDIO_PYTHON = (Resolve-Path .venv\Scripts\python.exe).Path
npm run dev
```

Optional server environment variables:

| Variable                      | Default  | Purpose                                                                      |
| ----------------------------- | -------- | ---------------------------------------------------------------------------- |
| `STUDIO_PYTHON`               | `python` | Python executable with faster-whisper installed                              |
| `STUDIO_WHISPER_MODEL`        | `small`  | Multilingual model name or local model path; avoid English-only `.en` models |
| `STUDIO_WHISPER_DEVICE`       | `cpu`    | `cpu` or a supported CUDA device                                             |
| `STUDIO_WHISPER_COMPUTE_TYPE` | `int8`   | Compute type supported by the selected device                                |

You can also set these values in an ignored `.env.local` file so `npm run dev` loads them automatically. The Python environment does not need to be activated when `STUDIO_PYTHON` points directly to its interpreter. Restart the studio after changing environment variables. Local Whisper does not diarize speakers: its segments begin with an **Unassigned speaker** placeholder. Listen to the source, add/split actors and turns, and correct assignments manually. Set Filipino/Taglish or English in Settings when language auto-detection needs help. Profanity and original words are retained in the app, but ASR accuracy must be reviewed.

**Keep / enter transcript manually:** works without Python or a speech API. Enter exact words and timestamps in Source & analysis, and save before analysis so OpenAI gets that context. Visual analysis never invents dialogue from frames. If you analyze before entering dialogue, the saved analysis includes a warning and you can add the transcript afterward.

**9router speech-to-text (optional):** select this only if you've configured a timestamp-capable transcription route in 9router. Paste its full model ID. The adapter requests `verbose_json` with segment timestamps; text-only results are rejected. A subscription chat connection alone is not a speech-to-text endpoint. This route may have separate upstream charges.

## Optional replacement images and speech

Both routes are disabled by default in **Optional image and speech routes**. Enabling a switch does not test or grant entitlement.

- Images use 9router's `/v1/images/generations` JSON extension with ordered reference images. The source composition is image 1; identity references follow it. Select a reference-capable Codex image model in the Flow workspace. `cx/gpt-image-2` is an example matching the reviewed router adapter, not a guarantee of account availability. A non-Codex text-to-image route can ignore reference inputs, so verify the output before reuse.
- Speech uses `/v1/audio/speech`. Save the model route without a voice suffix (for example `openai/gpt-4o-mini-tts`) and the voice separately (`alloy`). The adapter combines them as `openai/gpt-4o-mini-tts/alloy`. The reviewed OpenAI TTS adapter requires upstream API credentials inside 9router and may drop delivery instructions; it is not supplied automatically by subscription chat. Outputs are normalized to WAV with FFmpeg and cached. Voice design is unavailable on this branch.
- Keep **ORIGINAL** audio to avoid speech generation completely. UPLOADED and SILENT also work without a speech provider.

## Existing projects

Project/analysis/character files retain their existing layout. Completed Gemini analyses and generated audio/images remain reusable. The router settings use `studio:9router:connection`; old `v2p:gemini_*` settings are not loaded or forwarded. Legacy Gemini voice IDs remain intact. The character editor's **Use an OpenAI voice** action explicitly changes the saved voice before you generate new speech. This invalidates dependent audio/export decisions as appropriate, without repeating source analysis.

## Verification

`npm test` exercises a fake local HTTP router and real FFmpeg media, including authentication, timestamped vision inputs, cached retry, preserved manual transcripts, router transcription, image references and errors. `npm run test:e2e` checks settings persistence and the complete local assembly workflow. These tests do not use your subscription or make live generation requests. Local ASR quality and your account's live model/media access need a short real-source check after setup.

See [API charges](API_CHARGES.md) for separate subscription/API/Flow costs and the official documentation and router source used for these adapters.
