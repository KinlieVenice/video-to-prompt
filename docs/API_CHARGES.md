# API charges and Flow credits

Official documentation checked **23 October 2026**. API billing and Flow subscription credits are separate. The application never calls a video generation API or automates Flow.

## OpenAI through 9router

9router is local open-source routing software. This app uses the connection/account you configure there. Subscription quota, separate API billing, model entitlements and any router-side fallback are controlled by that configuration. A working chat subscription route is not proof of speech or image access, and this app does not promise unlimited/free generations. Configure fallback policies in 9router to avoid unintended paid routes. The studio does not send requests directly to the official paid OpenAI API or Gemini.

| User action                                                                    | External work                                                                                                                                  | Reuse / cost behavior                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect & load models                                                          | One router `/v1/models` request                                                                                                                | Discovery only; no generation request from this action.                                                                                                                                                                                                                                                                   |
| Analyze with OpenAI                                                            | One vision request per uncached eight-second window, plus at most one targeted refinement request per window; up to 33 JPEG frames per request | Consumes the selected route's allowance/billing. Successful window/stage results are cached for retries. The source panel shows the uncached request range. Completed analyses are reused across casts. **Refine motion timing** only revisits motion evidence; it never transcribes audio again.                         |
| Local transcription                                                            | Local CPU/GPU Whisper inference                                                                                                                | No speech API charge. Python dependencies and multilingual weights require initial downloads; disk/compute costs remain.                                                                                                                                                                                                  |
| Manual transcript                                                              | No provider request                                                                                                                            | Enter/correct dialogue and timestamps in the app.                                                                                                                                                                                                                                                                         |
| Optional router transcription                                                  | One timestamped speech-to-text request when no existing transcript/cache is available                                                          | Requires a capable upstream route; may be separately billed. Local subscription chat does not automatically provide it.                                                                                                                                                                                                   |
| Optional voice preview / line                                                  | One router speech request                                                                                                                      | Requires a configured speech provider (the current OpenAI TTS adapter requires upstream API credentials). Exact words and settings are cached; regeneration makes a new request. Delivery instructions may be dropped by the router adapter.                                                                              |
| Optional replacement images                                                    | Up to two router image requests per segment; one when a valid preceding last frame supplies the first                                          | Uses a reference-capable Codex image route. Quota/entitlements depend on the account. First/last endpoints and partial successes are cached. Extracting additional original key-pose references uses FFmpeg only, with no image-generation request. Before/after evidence refresh on timeline save also uses FFmpeg only. |
| Upload, scan, edit, map, plan, extract frames/audio, package, import, assemble | No AI provider request                                                                                                                         | Local disk/CPU only.                                                                                                                                                                                                                                                                                                      |

Voice design is not offered by this branch's router adapter. Previously saved Gemini voice IDs remain in profiles for compatibility; they cannot be used as OpenAI voices. Existing audio assets remain playable. See [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) for separately configured API routes, and 9router's dashboard for the connected account's actual usage. No fixed OpenAI dollar estimate is shown because a router route can represent subscription, API-key or other upstream billing.

## Manual Google Flow

Baseline estimates use one 720p generation per segment:

| Target                         | Duration               | Estimated credits                                 |
| ------------------------------ | ---------------------- | ------------------------------------------------- |
| Veo 3.1 Lite                   | 4, 6 or 8 seconds      | 10; 5 with Ultra                                  |
| Gemini Omni Flash              | 4 / 6 / 8 / 10 seconds | 7 / 10 / 12 / 15                                  |
| External reusable 2D animation | Source interval        | 0 Flow credits; external rendering costs excluded |

Retries, multiple outputs and upscaling add cost. Ultra lower-priority modes and 360p pricing are not inferred. Use the per-generation override when your account shows a different quote. Check [official Flow credit rates](https://support.google.com/flow/answer/16526234?hl=en) and confirm the quote in Flow before generating.

## Integration references

Official OpenAI schemas and 9router source were checked separately. Router-specific image reference fields and speech model routing must not be mistaken for official OpenAI API schemas.

- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [OpenAI speech generation](https://developers.openai.com/api/docs/guides/text-to-speech)
- [9router setup and endpoint](https://github.com/decolua/9router)
- [9router Codex image adapter and reference handling](https://github.com/decolua/9router/blob/master/open-sse/handlers/imageProviders/codex.js)
- [9router speech model dispatch](https://github.com/decolua/9router/blob/master/src/sse/handlers/tts.js)
- [9router OpenAI TTS adapter and upstream API credentials](https://github.com/decolua/9router/blob/master/open-sse/handlers/ttsProviders/openai.js)
- [faster-whisper local worker](https://github.com/SYSTRAN/faster-whisper)
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html)

Automated tests use a local fake router, mocked provider outputs and real FFmpeg media. They do not consume the user's subscription or API credits. Live account entitlements, ASR accuracy, visual identity and generated speech quality require testing with the user's configured providers. Whisper installation uses `scripts/requirements-whisper.txt` to avoid the PyAV 19 incompatibility in faster-whisper 1.2.1. Local setup and model caching are documented separately.

Motion sampling, uncertainty ranges and cost limits are described in [Motion analysis](MOTION_ANALYSIS.md).
