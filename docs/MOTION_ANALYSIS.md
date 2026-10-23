# Motion analysis and timing review

Detailed motion analysis replaces the former cap of eight sampled frames for an entire shot. It is available on new analyses and through **Refine motion timing** on an existing saved analysis.

## Evidence and refinement

1. FFmpeg measures image changes locally at four samples per second on scaled frames. Large differences identify candidate rapid-change ranges, not named actions: lighting, camera motion and effects can also produce peaks.
2. Each camera shot is analyzed independently in windows of at most eight seconds. Baseline samples are at most 0.5 seconds apart when source frame rate permits. Long shots get additional windows, rather than fewer observations spread over the whole shot.
3. Up to two rapid-change ranges per window receive additional quarter-second samples. OpenAI examines the ordered, timestamped images and returns structured setup/action/reaction/recovery/hold beats.
4. Ambiguous key beats can trigger one additional model pass with quarter-second samples around up to two candidate onset ranges. The complete window is reconsidered so the second pass can correct earlier guesses. Each request is capped at 33 frames, including one prior-window continuity image when applicable; source FPS and this budget can limit refinement. Refinement targets explicit onset uncertainty, not the duration of sustained activity.

Each window makes one initial model request and at most one refinement request. The source panel shows the uncached request range before the user starts. For a continuous 10.83-second clip, this means two windows and two to four model requests, rather than one request with seven frames. Image input tokens consume the selected router route's allowance or billing. There is no extra charge for the local FFmpeg measurements.

Both model stages and individual frames are cached with the source, analysis window, actors/transcript context, route, model and implementation version. A failed second stage can retry without paying for the successful first stage again. The `requests` value in sampling metadata counts logical analysis passes, including cached passes; it is not a billing counter.

Some uploads have audio that lasts longer than their video stream. Source duration continues to include the full soundtrack. If a frame seek falls in that tail, analysis and keyframe extraction use the final available video frame, located from actual frame timestamps rather than average FPS. Repeated endpoint images do not establish new movement. Requests outside the source duration still fail. For music or dance clips, select manual transcription and **ORIGINAL** audio to retain the uploaded soundtrack without generating speech; export applies that soundtrack to the imported clips.

## Activity spans, onset uncertainty and evidence

A sustained activity such as stirring from **0.500?2.750 seconds** has an observed span. It does not establish when the stirring began. Each beat separately records its timing meaning: **ACTIVITY**, **TRANSITION** or **OBSERVATION**. An optional onset range brackets an observed beginning between before/after samples; otherwise onset remains unknown. Already-ongoing actions have no new onset in that window and must not restart. Estimates between frames are widened to the surrounding observations.

The interface distinguishes **observed pose; AI description**, **inferred movement; review needed**, and **human-verified timing**. Model-provided high confidence never makes timing verified. Internal evidence support is limited to LOW or MEDIUM for automated results and is not a calibrated probability. Snapshot descriptions themselves can be wrong; compare the images and original footage. See the [official OpenAI vision limitations](https://developers.openai.com/api/docs/guides/images-vision).

Each generated beat includes before/after evidence frames. When onset is known, these show the observations bracketing onset; otherwise they show the observed span's endpoints. State descriptions explain the visible change. Key-pose images are additional references inside the observed span. The evidence and state descriptions are also included in the Flow ZIP manifest, with their image files.

In **Source & analysis ? Edit shot boundaries, motion and camera**, edit the observed span, timing meaning, separate onset fields, ongoing-action status and state descriptions. **Review in slow motion** plays the source at half speed. Only mark **Timing reviewed against source** after checking it yourself. Editing timing refreshes the evidence images on save using FFmpeg, without a model request. Selecting recovery requires an observed settled state. Existing free-text/v2 timelines remain readable and are labeled as legacy timing rather than upgraded to precise onset claims automatically.

## Continuity between analysis windows

Only the beginning of a camera shot may introduce setup. Later windows receive the previous window's final image and explicit actor pose, hand/limb positions, object condition and ongoing action. They must continue the performance without resetting props or replaying reactions. If a model nevertheless labels a later-window pose as setup, the result is normalized to continuation of the preceding action/reaction or a held state.

Recovery requires both a settled-state indication and a concrete observed after-state; an intervention while a failure remains active is ongoing action. Closing-state contradictions at a window boundary are flagged by retaining the action classification. These checks improve consistency; they do not prove a model's scene interpretation is correct. Directions use screen-left/screen-right and consistent hand/prop descriptions.

## Refining saved projects

**Refine motion timing** never runs Whisper or router transcription, including when dialogue is empty. It preserves words, turn timestamps, actor IDs/descriptions, character mappings and shot boundaries/scene descriptions. Human-reviewed beats win over overlapping new beats of the same phase. Unreviewed motion is replaced with the new evidence-backed draft. The v3 cache is separate from older ambiguous timing results; use refinement to upgrade existing clips without re-uploading.

The analysis revision changes only after every window succeeds. Failed refinements leave the previously saved analysis intact. Successful refinement invalidates old exports and makes existing segment plans stale; replan before generating references or assembling. As elsewhere in this app, replanning resets this version's frame/clip assignments while keeping the media files on disk.

## Flow handoff

Motion plans are filtered to each segment, sorted, clipped and expressed in seconds from that segment's start. A span crossing a segment boundary is explicitly marked; onset uncertainty is clipped/rebased separately. Sustained movement is marked already ongoing in the next segment rather than started again. A prior observed state can be included as context, with instructions not to replay the earlier action. Legacy timestamp lists are also rebased and labeled as pose observations with unknown onset.

The planner avoids splitting key onset/transition ranges when it can do so without adding a generation; it does not confuse an entire sustained activity with its onset. Extracting references includes up to three key-pose images per segment, prioritizing action/reaction beats. They are included in the downloadable ZIP and manifest with the local motion plan. These are original source pose references; the UI and prompt identify them as composition/motion evidence, with replacement identity supplied separately by character references. Automatic character replacement still covers only the first/last frames.

Adjacent segments of the same shot with no overlap share an identical full-resolution source boundary image. Generate their replacement references in order: when the preceding generated last frame matches the current source, cast, model and route, it is reused as the next first frame. This saves one image request and preserves replacement appearance at the join. Hard cuts, overlaps and stale/different-character references are not inherited. Changes to an inherited parent image make the dependent link stale; the workspace asks you to regenerate it. Extracted evidence/key-pose frames still contain the original actors and are labeled accordingly.

Google Flow generation remains manual. Better observations and instructions improve the handoff; they do not guarantee matching generated motion or exact comic timing. Compare generated clips against the source before assembly.
