# API charges and Flow credits

Official documentation checked **23 October 2026**; the experimental browser test below ran **24 October 2026**. API billing and Flow subscription credits are separate. This branch includes a manual workspace and an optional [local browser-backed Flow API](FLOW_BRIDGE_API.md). The bridge uses the signed-in Flow subscription and requires its dedicated Chrome process to remain running.

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

Saving the optional source description makes no provider request. Applying a changed description with **Update analysis with description** or motion refinement uses new visual-analysis cache keys and can make the same model requests as normal analysis. Existing transcript text and speech caches are reused; saving text alone never starts generation.

Background and expression controls add no analysis or speech requests. Reference generation still uses up to two image requests per segment (one with a valid inherited first frame). For a new background, the last-frame request includes the generated first frame as an additional environment reference; image-input usage follows the selected provider route. Changing a look requires new reference images and manually generated Flow clips, with new image usage/Flow credits. Previously generated files remain on disk.

Scene completion uses the same image requests and source analysis, with no extra AI call. Preparing an aspect-ratio canvas uses local FFmpeg and is cached. Its generated first-frame environment reference adds image input to the existing last-frame request, under the selected image route's usage rules.

Baseline estimates use one 720p generation per segment:

| Target                         | Duration               | Estimated credits                                 |
| ------------------------------ | ---------------------- | ------------------------------------------------- |
| Veo 3.1 Lite                   | 4, 6 or 8 seconds      | 10; 5 with Ultra                                  |
| Gemini Omni Flash              | 4 / 6 / 8 / 10 seconds | 7 / 10 / 12 / 15                                  |
| External reusable 2D animation | Source interval        | 0 Flow credits; external rendering costs excluded |

Retries, multiple outputs and some upscaling operations can add cost. Ultra lower-priority modes and 360p pricing are not inferred by the existing planner. Use the per-generation override when your account shows a different quote. Check [official Flow credit rates](https://support.google.com/flow/answer/16526234?hl=en) and confirm the quote in Flow before generating.

## Experimental Flow browser test

The local bridge separates **Prepare** from **Generate**. Preparing uploads references and reads the live account quote without submitting video generation. Generate submits one output only after the operator selects the quoted credit amount; changed quotes and drafts fail before submission. Refresh, download and import do not request another generation. An uncertain submission is not automatically retried. Upscale only submits if live model pricing confirms zero cost; cached results are reused.

**Generated clip audio** uses local FFmpeg and preserves imported Flow audio without a TTS call. **Original** remains the default for the source soundtrack. The additional implementation smoke tests prepared first/last and voice drafts and downloaded the existing diagnostic outputs; they spent no additional Flow credits. The new adapter's charged submission path has not been live-tested with a fresh generation.

On 24 October 2026, the user authorized one diagnostic generation with a maximum cost of 4 Flow credits and an upscale only if free. This used the signed-in Flow subscription through its native browser UI, with REA recording the operation. No separate OpenAI, 9router or official Gemini API call was made for this test.

| Operation                                         | Observed usage                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Omni 1.1 Flash, 4 seconds, 360p, 9:16, one output | 4-credit quote; one accepted generation                                          |
| Original MP4 download                             | No additional generation                                                         |
| Omni 360p to 720p upscale                         | Live account model price 0; returned balance unchanged after the upscale request |
| Download completed upscale again                  | Existing result reused; no additional upscale request                            |
| Total                                             | **4 Flow credits; 0 additional credits for upscale**                             |

Both files passed FFmpeg inspection: 360 x 640 at 4.011 seconds and 720 x 1280 at 4 seconds, each 24 fps with H.264/AAC. This confirms those particular operations on this account. It does not establish native 720p generation, first/last-frame upload, voice-preview pricing or voice-generation support. Other models, output counts, durations and account tiers need their own live quotes. See the [Flow bridge investigation](FLOW_REA_BRIDGE.md) for evidence and remaining implementation work.

## Integration references

Per-actor appearance notes add no analysis or voice requests. Saving changed notes requires regenerated visual references and Flow clips for that version, using the image/Flow usage described above. Cosmetic changes do not trigger TTS regeneration or alter a saved voice.

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

The normal automated test suite uses a local fake router, mocked provider outputs and real FFmpeg media. It does not consume the user's subscription or API credits. The separately authorized live browser test above consumed Flow credits and is not part of that suite. Live account entitlements, ASR accuracy, visual identity and generated speech quality require testing with the user's configured providers. Whisper installation uses `scripts/requirements-whisper.txt` to avoid the PyAV 19 incompatibility in faster-whisper 1.2.1. Local setup and model caching are documented separately.

Motion sampling, uncertainty ranges and cost limits are described in [Motion analysis](MOTION_ANALYSIS.md).
