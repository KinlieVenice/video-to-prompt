# Local reenactment pipeline

This is a single-user Next.js Node application. It uses the existing TypeScript/React app and Gemini SDK Files API. Current generation requests use the documented REST Interactions and Voices APIs, avoiding a dependency on SDK features missing from the original pinned SDK.

## Persistence

```text
.studio/
  analyses/<id>.json       Source, FFmpeg evidence, actors, shots, exact editable turns
  characters/<id>.json     Appearance, references, provider/model/voice/settings
  projects/<id>.json       Analysis ID plus independent reenactment versions
  cache/<hash>.json        Source, transcription, visual, TTS and image reuse indexes
  assets/<uuid>.<ext>      Original media, takes, frames, clips, packages, exports
```

All paths are relative to the local data directory. Atomic temporary-file renames protect JSON writes. One process-wide queue serializes mutations and paid requests. Use one server instance for a data directory. This is not a multi-tenant/cloud storage service.

Reuploading identical source bytes reuses the source analysis. Multiple projects can point to that analysis; source corrections affect them all. Versions can have different mappings, audio modes, plans, clips and export settings. Character profiles are reusable shared records; editing one affects its linked versions. Create another profile when preserving a different character identity or voice variant. Duplicating a version copies its mappings and saved asset assignments without rerunning analysis.

The browser stores only the Gemini key, selected analysis model, and last project ID. The key is sent to the local server only for provider actions; it is not saved in JSON, manifests or assets. Gemini actions send the relevant media/text/images to Google. Project storage is local, not a promise that AI analysis works offline.

## Service boundaries

| Service                     | Responsibility                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `VideoAnalysisService`      | FFprobe metadata, FFmpeg hard cuts and audio evidence; cached Gemini visual analysis                       |
| `SpeakerDiarizationService` | Separate audio-only speaker transcription; decimal timestamps; conservative activity-boundary snapping     |
| `CharacterService`          | Validate and persist reusable character and voice profiles                                                 |
| `VoiceService`              | Exact per-turn TTS, previews, designed voices, cached WAV takes, original-audio extraction                 |
| `KeyframeService`           | First/last source frames and cached image replacement through `ImageGenerationProvider`                    |
| `ScenePlannerService`       | Hard-cut-safe segment coverage, pause preference, supported durations, controlled overlap and credits      |
| `PromptGenerationService`   | Character-agnostic manual Flow prompts with original dialogue and motion timing                            |
| `VideoAssemblyService`      | Clip validation/trim/normalization, concat, aligned audio, captions, disclosure, MP4 and Flow ZIP packages |

`POST /api/studio` accepts multipart form data: `action`, JSON `payload`, and an optional `file`. IDs and edit payloads are validated. `GET /api/studio` loads the saved state. `/api/assets/<uuid.ext>` supports byte ranges for video seeking. Host and Origin checks constrain these APIs to the local workspace. FFmpeg runs directly with argument arrays, without a shell.

## Timing and quality

FFmpeg evaluates scene changes on scaled frames without reducing the source frame rate. `silencedetect` yields independently measured audio activity. Activity is not word alignment or proof of speech: music, overlapping voices, noise and quick cuts still need review. Gemini provides a draft transcript and speaker labels; nearby activity endpoints can refine timestamps within 150ms. The visual pass links anonymous speakers to visible actors where supported and includes silent actors. Uncertain identities remain reviewable.

Shot corrections must cover the complete source without gaps/overlap. Speaker turns can overlap or cross camera cuts. The planner never merges shots; long continuous shots prefer nearby turn ends/pauses without adding avoidable generations. Unsupported 10-second Veo Lite plans are rejected. Extension starts with a new frame-based generation and only continues within the same shot. The 2D strategy is an external render/import fallback, not a built-in rigging engine.

Each generated take is immutable. Text, emotion or saved voice changes make it stale. Timing and playback speed do not regenerate speech. Assembly blocks missing/stale takes and speech outside its allocation; adjust line offsets/speed or correct source timestamps rather than rewriting words. Uploaded clean background stems can be mixed with TTS. Automatic background separation and forced phoneme alignment are optional external preprocessing, not implemented in this MVP.

Generation overlap is discarded from the beginning of the next clip. Export rounds cumulative frame boundaries at 30fps to avoid accumulating per-clip drift. Letterboxing preserves composition in 1280×720 or 720×1280. Final duration is checked within 100ms. Original mode preserves the recorded performance; MP4 encoding converts its soundtrack to AAC. Captions are optional MP4 subtitle tracks; disclosure is a visible overlay. Mouth synchronization is reviewed manually, not automatically scored or repaired.

Originals, generated outputs and intermediate files remain on disk for reuse. There is no automatic destructive cache cleanup. Back up the complete data directory, and monitor disk space for long projects. The 512MB/10-minute source limit keeps the in-memory multipart MVP manageable; use short clips for low-cost iteration.
