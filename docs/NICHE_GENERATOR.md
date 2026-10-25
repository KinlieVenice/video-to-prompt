# Reusable niche generator

## Optional hooks, examples and source material

Every niche can work without reference videos or scripts. In **Create niche / Edit niche**, the optional **Opening hook** dropdown offers Automatic, Direct question, Curiosity/open loop, Relatable feeling/problem, Start in the action, Unexpected contrast, Result/benefit first, Numbered takeaways, Visual reveal and Custom. Custom accepts an opening line, template or instructions that the planner adapts to each topic and language. Automatic preserves topic-only use. These are reusable formats, not a live trend ranking or a promise of virality.

When a video is uploaded, it is the **main format reference** for structure, pacing, camera, delivery and visual storytelling; scripts become secondary examples for tone, wording and ending. The first uploaded video is main by default. With multiple videos, **Use as main reference** changes their priority without rerunning analysis. Removing the main reference promotes the next one. Without videos, the description and optional scripts supply the main format guidance. Explicit character, art style, length, language, hook and storytelling settings still take precedence over reference suggestions; source material supplies facts rather than style examples.

The categories synthesize [TikTok's hook examples](https://ads.tiktok.com/business/creativecenter/quicktok/online/creative_tips_travel/pc/en), [TikTok's hook/body/close guidance](https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads), and [YouTube's immediate intrigue and payoff guidance](https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/), checked 25 October 2026. Dropdown examples are original. Question, list and benefit categories are directly discussed by TikTok; relatable, contrast, cold-open and visual-reveal options are our practical applications of those broader attention/storytelling principles, rather than platform rankings. The opening must fit the allocated scene budget and its payoff must appear in the video.

Expand **Optional scripts, sources and storytelling** to supply any of:

- **Sample scripts**: paste examples, or import UTF-8 `.txt` / `.md` files (256 KB per file, 24,000 combined characters). Imports append editable text and make no model request. Save the niche to persist it. Scripts guide delivery and structure rather than supplying words or facts to copy.
- **What to learn from examples**: direction for both scripts and reference videos, such as short sentences, a curious opening or gentle delivery.
- **Story structure**: any reusable format, such as problem → demonstration → result, or hook → story → reflection → comfort.
- **Ending guidance**: comfort, practical advice, a reveal, a question, or another finish that fits the niche.
- **Source reference** and **Source material**: source titles, notes, product details, historical material, passages or facts to ground content. Reference labels/URLs are not fetched or verified. Paste relevant source text and put per-topic details in Topic. These fields apply to any niche; there are no mandatory religious inputs.

Saved fields are included in the planning request, its cache key and each topic's frozen niche snapshot. Changing them affects future topics without repeating video analysis. Large examples increase text-provider input usage.

Enable **Review script before generating media** to stop after text planning. Review cards open automatically, support narration and scene/frame edits, and enforce scene count and spoken-word budgets. Save edits, then choose **Approve & generate video**. Saved edits update the actual narration, motion and frame plan used by the runner. Reload restores pending reviews. No speech/image/Flow generation starts from Create video in this mode; text planning still uses the configured provider. Once generation has started, use a new topic video for script changes. Leave review unchecked to retain automatic assembly. This is an optional content review, not automatic fact verification.

## Basic workflow

Open **Niche generator** in the sidebar, then **Create niche**. Save:

- A name and detailed brief: audience, hook, tone, structure, pacing, ending and exclusions.
- **Art style**, such as watercolor, anime, cinematic 3D or flat 2D. Blank inherits the character's saved visual style. An explicit niche style overrides reference-video and character rendering style while preserving character identity.
- Whole-video length (4–180 seconds), language and saved character.
- Audio: saved character TTS, Flow-generated dialogue, an uploaded finished recording, or silence.
- Generation defaults: model, resolution, clip-duration limit, first/last or other frame strategy, aspect, expression, image provider and optional background direction.
- A total Flow credit limit per video. Initial estimates update with a new template's length/settings until manually overridden. Account quotes are checked during the run.

Save the niche, then add up to six MP4/MOV references with **Upload & analyze reference**. Analysis uses the existing local FFmpeg scan plus OpenAI through 9router. Already analyzed identical footage is reused. A failed analysis stays attached as a pending reference, so **Analyze saved reference** can retry without uploading again. Remove a reference to stop using it without deleting shared media or analysis. An uploaded-recording niche must also save its recording.

Select a niche, enter a **Topic**, and click **Create video**. No source video upload or new per-video cast/settings is required. The app writes an original script and planned scenes using the niche description, art style, character body/identity description and compact samples of the reference analyses. Samples span the beginning, middle and end; reference dialogue supplies delivery/structure evidence and is not requested as copied narration. Empty reference lists support brief-only generation.

The planner allocates exactly the saved total duration using the fewest clips under the maximum, avoiding unnecessarily tiny final scenes where possible. A 30-second video with an eight-second maximum uses 8/8/8/6-second scenes. First and last images are newly composed from the scene plan and character references. The last-image request uses the generated first image as its environment/identity anchor. The automated runner then handles selected audio, Flow submissions, downloads and final FFmpeg assembly.

Keep this view open, the local app running, and the dedicated Chrome signed into a Flow project. Reloading restores the selected niche and latest saved generation. Pause/resume and credit-limit controls use the existing run engine. Historical scripts and completed downloads remain available. Editing a niche affects future topics; each topic stores a snapshot, script, reference revisions and independent project. Character profiles remain shared; create a separate character profile to preserve an alternate identity/voice configuration.

## Defaults and storage

New niches inherit the existing `STUDIO_DEFAULT_*` generation settings from `.env.local`, plus:

```dotenv
STUDIO_DEFAULT_NICHE_DURATION=30
STUDIO_DEFAULT_NICHE_LANGUAGE=English
STUDIO_DEFAULT_NICHE_ART_STYLE=
```

Restart Next.js after editing environment defaults. Saved niches retain their own settings. Since generated topics have no original soundtrack, the inherited `ORIGINAL` audio preset becomes character TTS when creating a niche; other supported audio defaults carry over. Saved character TTS requires a working 9router speech model/voice; Flow dialogue uses generated voices rather than the saved TTS voice. Native Flow voice-reference selection still requires Ingredients mode, as described by [Google's voice-reference instructions](https://support.google.com/flow/answer/16353334?hl=en). Models and features were checked against [official Flow capabilities](https://support.google.com/flow/answer/16352836?hl=en) on 25 October 2026; the adapter retains its narrower previously inspected browser controls rather than assuming all documented options work on every account.

```text
.studio/niches/<id>.json        Reusable niche settings and reference analysis IDs
.studio/niche-videos/<id>.json  Topic, frozen niche snapshot, script and project/run links
.studio/analyses/<id>.json      Uploaded observations OR explicitly marked planned storyboard
.studio/projects/<id>.json      Independent topic version, frames, audio, clips and export
.studio/runs/<id>.json          Automatic generation progress and credit reservations
.studio/cache/                 Script, image, source-analysis and speech reuse
.studio/assets/                References and generated media
```

All of these stay in the ignored local data directory. Credentials are request-only. Art style participates in planning and image cache keys; changing it does not silently reuse images from another style.

Generated projects are marked `origin: PLANNED`. Their tiny black MP4 is explicitly a local timing scaffold, never input to AI frame generation or source analysis. It provides no source soundtrack and must not be presented as observed footage. Planned frames have a separate generator; ordinary reenactment retains its existing source-frame adapter. Export packages include the planned script and origin. The existing assembler normalizes output to 720p; 360p is the default Flow generation resolution, not an AI upscale.

## Charges and validation

Reference analysis incurs the existing analysis/transcription usage only when needed. Each uncached topic requires a text-planning request, up to two image requests per scene, optional TTS requests and one Flow generation per planned scene. Script/image/TTS usage through 9router is separate from the total Flow credit cap. FFmpeg timing scaffolds, concatenation and final assembly are local. Cached script/image stages and idempotent topic request IDs prevent repeated work on ordinary retries. Flow's uncertain-submission handling remains unchanged: ambiguous paid requests pause rather than automatically resubmit.

Model-generated facts, words, images and mouth synchronization require review. Narration is word-budgeted before speech generation, and overlong speech pauses before video charges rather than silently rewriting it. An uploaded finished recording is used instead of generated narration; no audio is copied from style references. The reference-guided format is approximate, not training or an exact learned replica.

Automated tests use fake language/image/Flow providers and real FFmpeg for a complete planned-video render. The browser test covers saving art style, analyzed references, reload, topic-only creation and final download. No paid generation is performed by these tests; a fresh paid end-to-end niche run remains to be validated on the connected providers.

## Local API

`GET /api/studio/niches` returns niche templates, reference analyses, topic records and public defaults. `POST` uses multipart `FormData` with a JSON `payload` and optional `file`. Actions: `save`, `upload_reference`, `analyze_reference`, `upload_audio`, `create_video`, `save_plan` and `start_video`. Topic creation requires `nicheId`, `topic` and a UUID `requestId`; the same request ID returns the same planned project/run. With `storytelling.reviewBeforeGeneration`, `create_video` returns `{video}` without starting a run. `save_plan` accepts `videoId` and `value: ContentPlan` for unstarted storyboards; `start_video` approves/starts the saved storyboard by `videoId`. Run progress continues through `/api/studio/runs`. All endpoints retain local host/origin checks and the serialized write queue.
