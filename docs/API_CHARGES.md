# API charges and Flow credits

Official documentation checked **23 October 2026**. API billing and Flow subscription credits are separate. The application never calls a video generation API or automates Flow.

## Gemini API

| User action                                                                       | External work                                                                                   | Reuse / charge behavior                                                                                                |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Analyze with Gemini                                                               | One audio transcription request (if the source has audio), then one video understanding request | Successful intermediate results are cached. Completed analysis is reused across characters and versions.               |
| Generate line / voice preview                                                     | One single-speaker TTS request                                                                  | Exact transcript and voice settings form the cache key. Cached requests incur no new API call.                         |
| New take                                                                          | One new TTS request                                                                             | Explicitly bypasses the cache; earlier takes remain saved.                                                             |
| Design voice                                                                      | One Voices API request                                                                          | Saves the returned voice ID and sample. Repeating design creates another billable provider operation where applicable. |
| Generate replaced frames                                                          | Up to two image requests per segment                                                            | First and last endpoints are cached separately, including partial success.                                             |
| Upload, scan, correct, map, plan, extract frames/audio, package, import, assemble | No Gemini requests                                                                              | Local disk and CPU only.                                                                                               |

Gemini 3.8 Flash-Lite TTS and Flash TTS are supported through the documented REST Interactions API. The unchanged line goes in `text`; delivery goes in `speech_metadata`. Both accept prebuilt or designed voice IDs. Provider availability, quotas and content rejection still apply. A rejected line is reported; the app does not rewrite or censor it.

The published standard paid TTS rates, per million tokens, are $0.50 text input and $6 audio output for Flash-Lite, or $0.50 input and $9 output for Flash, through 31 December 2026. Listed rates double on 1 January 2027. Free tier eligibility varies. These are reference rates, not an invoice or an in-app dollar estimate. See [official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) for analysis, images, voice design, quotas, and the current price of each model.

Voice design is provider-side persistence, distinct from the local character library. Keep the local ID and use the same Google project when synthesizing. Provider voice lifetime and access rules can change. See [Voice design](https://ai.google.dev/gemini-api/docs/voice-design) and [speech generation](https://ai.google.dev/gemini-api/docs/speech-generation).

## Manual Google Flow

Baseline estimates use one 720p generation per segment:

| Target                         | Duration               | Estimated credits                                 |
| ------------------------------ | ---------------------- | ------------------------------------------------- |
| Veo 3.1 Lite                   | 4, 6 or 8 seconds      | 10; 5 with Ultra                                  |
| Gemini Omni Flash              | 4 / 6 / 8 / 10 seconds | 7 / 10 / 12 / 15                                  |
| External reusable 2D animation | Source interval        | 0 Flow credits; external rendering costs excluded |

Retries, multiple outputs and upscaling add cost. Ultra lower-priority modes and 360p pricing are not inferred. Use the per-generation override when your account shows a different quote. Check [official Flow credit rates](https://support.google.com/flow/answer/16526234?hl=en) and confirm the quote in Flow before generating.

## Official integration references

- [Video understanding and file inputs](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Interactions API request and response format](https://ai.google.dev/api/interactions-api)
- [Image generation and image references](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini Omni Flash capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash)
- [Flow feature and strategy constraints](https://support.google.com/flow/answer/16352836?hl=en): Veo Lite ingredients and extension use eligible 8-second clips. Omni first/last-frame generation is supported on Flow web.
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html)

Provider integrations are covered with mocked responses. No live Gemini or Flow calls are made by the test suite; a user API key is needed to validate a real account's access and generation quality.
