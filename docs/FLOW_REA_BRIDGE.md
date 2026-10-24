# Flow subscription bridge investigation

Branch: `feat/flow-rea-bridge`, based on `feat/background-expression` commit `51f2398`.

Status: an [experimental local API and Recast workspace integration](FLOW_BRIDGE_API.md) are implemented. The original authorized 360p generation, original download, free 720p upscale and upscale download completed through the signed-in browser. Both MP4s passed FFmpeg inspection. Implementation smoke tests additionally verified first/last uploads and quote retrieval, Ingredients-plus-voice draft preparation, status lookup and existing-result downloads through the new adapter, without further generation credits. Fresh paid submission through the new adapter and generated voice quality remain unverified. The manual workspace remains available.

## Subscription and REA

The proposed bridge would operate the user's signed-in Flow account and consume its Flow credits. It would not turn those credits into an official Gemini API entitlement. Google distinguishes [subscription access from paid API requests](https://discuss.ai.google.dev/t/does-google-one-ai-pro-include-api-access-for-veo-3-or-is-it-limited-to-flow-only/110794/6). [Flow credit usage](https://support.google.com/flow/answer/16526234?hl=en) remains account-wide and model dependent.

[REA](https://github.com/morluto/rea) supplies browser observation, script analysis and scenario capture through CLI/MCP. It does not ship a Flow provider or create an API automatically. Its [CDP observation](https://github.com/morluto/rea/blob/main/docs/browser-observation.md) can inspect a caller-owned browser; [scenario capture](https://github.com/morluto/rea/blob/main/docs/browser-scenario-contract.md) can record controlled actions. Those observations would inform a separate local adapter.

## Required controls

| Control              | Documented Flow behavior                                     | Live adapter status                                                                                               |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Start and end images | Frames mode supports separate endpoints                      | Both uploads and a valid first/last draft verified through the new API; fresh charged frame generation unverified |
| Model                | Gemini Omni Flash and Veo 3.1 Lite are distinct models       | Omni text generation verified with `abra_t2v_4s_360p`; other job variants unverified                              |
| Aspect               | Landscape and portrait                                       | 16:9 and 9:16 observed; portrait selection exercised                                                              |
| Resolution           | Omni supports 360p and 720p                                  | Native 360p generation and 720p upscale verified; native 720p generation unverified                               |
| Voices               | Preset and custom voice references in Omni Ingredients mode  | Visual-plus-voice draft verified through the new adapter; generated voice quality unverified                      |
| Upscale              | Pro/Ultra can upscale Omni 360p to 720p at zero Flow credits | Job, zero additional cost and downloaded 720 x 1280 output verified                                               |

Sources: Google's [model capabilities](https://support.google.com/flow/answer/16352836?hl=en) and [creation instructions](https://support.google.com/flow/answer/16353334?hl=en). Feature availability can vary by region. “Omni Flash Lite” is not the combined model name in those sources; the adapter must use observed account controls rather than guessing a model ID.

Google explicitly documents voice references as Ingredients-only. Supporting Frames and Voices separately does not establish support for both in one generation. The combined requirement needs an account-level check before implementation. The bridge must report unsupported combinations instead of silently switching modes. Original/uploaded/final-assembly audio remains available in Recast.

## Inspection sequence

1. Run pinned REA in an isolated tool directory with a compatible portable Node runtime. Do not change the app's dependencies or global agent registration.
2. Attach to a separate Chrome profile on loopback CDP. Initial public-page inspection establishes tooling only; the user must sign into Flow for account features.
3. Capture Frames controls, upload roles, models, durations, aspect and resolution. Record evidence for each capability rather than deriving it from an endpoint name.
4. Inspect Voices in Ingredients and check whether Frames plus voice is actually accepted. Read the account's available voice choices without inventing IDs.
5. Observe one authorized generation through completion, then an upscale and download. Capture upload/job/result contracts with credentials redacted and retain evidence only in ignored local storage.
6. Implement the adapter once the contracts are verified. Keep authentication failures, user challenges, model errors and upscale failures distinct. Prevent duplicate submissions during polling or retries.

## Intended integration

Recast would submit a job to a loopback-only bridge with the prompt, first/last frame assets, target model, duration, aspect, resolution, optional supported voice reference and requested upscale target. The browser session supplies the user's Flow access. The bridge would return a generation job ID, progress, generated clip, optional upscale job and final download for the existing clip importer.

Generation and upscale must be separate tracked operations. Preserve a completed base clip if upscale fails. Flow upscaling must not be represented by local FFmpeg resizing. Confirm actual credit quotes, output count and feature support before submission; retain existing source timing and assembly audio modes. No video-to-video editing is included.

Recast currently discards imported video sound during normalization and applies the selected assembly soundtrack. Native Flow voice output therefore also needs an explicit clip-audio assembly mode; merely selecting a voice during generation would not preserve it in the final export. Keep original-song exports as the existing default and make Flow-generated voices an intentional audio choice. Voice selection is not a substitute for source transcript/timing review.

The browser generation/download/upscale path is verified and an experimental Recast adapter is implemented. Its charged submission handler still needs a fresh authorized live test; draft preparation and existing-result retrieval are verified without new credits.

## Local tooling and observed result

Prepared and tested on Windows with REA **6.7.0**, portable Node **22.23.4**, and Chrome **155.0.8059.86**. Both tool packages live under ignored `.tmp/rea-tools`; the application dependencies and global Node/Codex configuration are unchanged. The bundled [reverse-engineer-anything workflow](../.tmp/rea-tools/node_modules/rea-agents/skills/reverse-engineer-anything/SKILL.md) was read for browser observation. This uses the CLI directly, not a new MCP registration.

Actual REA `list_browser_targets` and `inspect_web_page` calls succeeded against a separate headless Chrome profile. The public Flow URL redirected to `https://flow.google.com/about`. Discovery evidence: `ev_f170f0d31251b11e00ff5b2c33c54f487831e533684175c0cbb9a4a30d50a97e`; page evidence: `ev_f424ba6dba3141227cfb7a373e444c4afb899da140081444797ffba1aed312c2`. Raw output is retained under ignored `.tmp/flow-rea/`. The page observation is policy-filtered and attach-limited; it does not include earlier requests or establish authenticated generation support. The test browser was stopped after inspection and its separate local profile retained.

From PowerShell at the repository root:

```powershell
# Already prepared on this machine; use on a fresh setup.
./scripts/flow/install-rea.ps1
./scripts/flow/rea.ps1 -ReaArguments @('--version')

# Run explicitly with -Visible for the interactive Google sign-in step.
./scripts/flow/start-inspection-browser.ps1 -Visible
# After signing into Flow and opening a project:
./scripts/flow/capture-page.ps1
# Stop only the browser process belonging to this dedicated profile:
./scripts/flow/stop-inspection-browser.ps1
```

The browser helper defaults to headless operation without `-Visible`. Its CDP port defaults to loopback `9223`. The stop helper verifies the recorded process/profile before stopping it. Sign-in pages are excluded from page capture. No tracked script submits a generation or upscale request.

## Authenticated inspection, 24 October 2026

The user signed into the separate visible browser and opened an empty Flow project. REA connected to that existing tab. No session cookies or authorization header values were exported. Later request-body captures contain browser-generated verification data and must be treated as sensitive local evidence. All raw evidence and account-specific scenarios remain under ignored `.tmp/flow-rea/`; do not commit or share them.

- **Video settings** (`video-settings-capture.json`, evidence `ev_bffa236f6cd9a39c41c7e5a350cc5a8e907b32a8b0187a2d18607323b9be06eb`): the account exposes Omni 1.1 Flash, Veo 3.1 - Lite, Veo 3.1 - Fast and Veo 3.1 - Quality. Omni exposes Frames/Ingredients, 16:9/9:16, 360p/720p, 4/6/8/10 seconds and x1/x2/x3/x4 outputs. The initial x2, 720p, 8-second setting quoted 24 credits; the adapter must explicitly set output count rather than inherit this preference.
- **Frames settings** (`frames-settings-capture.json`, evidence `ev_a3408fe6088438ffdda2e20c5558eff51e145fd76dfba9b342528516d4e13d3e`): selecting Frames, 9:16, 360p, 4 seconds and x1 succeeded. Flow quoted **4 credits**. Start, End and Swap first and last frames were present. Start generation remained disabled with no assets/prompt.
- **First-frame picker** (`start-frame-capture.json`, evidence `ev_529272fe48aad6f8c79464561dbdf952f96f6ab669190b9559d3c13fce4f612d`): Start opens "Select a frame image", with Images/Uploads tabs and Upload media. This project had no assets. Opening this picker does not verify an upload contract.
- **Voice library** (`voice-library-capture.json`, evidence `ev_6c867aa34bef2b808736196280cfda284409537e4b0094b3d48bbe82765d6d30`): Video > Ingredients > Add > Voices exposes preset choices (including Achird, Achernar, Aoede and Charon), Sample dialogue, Customize performance, Play preview and Add to prompt. No preview was played or generated. Visible names are UI choices, not verified backend voice IDs.
- **Voice attachment** (`attach-voice-capture.json`, evidence `ev_254016e2284c77def3eb1fa6918607e4bd81b9348e96fc62fd11c5ac3cc8c6d9`): selecting Achird and Add to prompt added an audio ingredient chip. Switching to Frames removed that chip (`voice-frames-capture.json`, evidence `ev_bd91d9bd38a6dca860cd4c07f2dbecd98d258a013b460b94e3f48fe86731f387`). This does not establish simultaneous Frames-plus-voice support.
- **Voice-only validation** (`prepared-test-capture.json`, evidence `ev_9a55161d7a29efdfea2bb260f87b8bf3e1594157649b75a6f48c9aa3ea1ff761`): an Omni Ingredients draft with a preset voice and text, but no visual ingredient, showed an error-marked audio chip and disabled Start generation. The captured application bundle contains a `MISSING_VISUAL_INGREDIENT` validation reason with a message requiring other ingredients for audio. This supports a visual-reference requirement; a valid voice job has not yet been prepared. Do not infer that changing resolution fixes it.
- **Veo Lite** (`veo-lite-capture.json`, evidence `ev_3c812e9223da66dfd55dc2ad19394e5ba346593ac860f07a7a045708aecc6583`): selecting Veo 3.1 - Lite succeeded. This account's menu displayed 720p, 8 seconds and x1 with a **10-credit** quote, and no resolution/duration radio groups. Official capability tables alone must not override the live account controls.

The installed REA 6.7.0 scenario action schema has no file-upload action. Its current declarative actions establish the UI controls but cannot alone verify `setInputFiles`. The eventual bridge will need a file-upload implementation and an observed upload/result contract; do not substitute a guessed endpoint. Generation, upscale and download were subsequently inspected using the authorized text-only result below.

## Static candidates, not verified request contracts

Passive REA script capture included the observed Flow application bundles from `https://www.gstatic.com` as well as the project origin (`flow-app-scripts.json`, evidence `ev_bd4121bf549d0abf0c0b0774e2a97e412b4f06cfbdaa0adf5e48834208350fb4`). This did not execute bundle functions or replay requests. Unrelated sign-in/analytics origins were excluded. Captures retain their policy-filtered, attach-limited coverage.

The shipped bundle declares RPC candidates `VideoFxService.BatchAsyncGenerateVideoStartImage`, `BatchAsyncGenerateVideoStartAndEndImage`, `BatchAsyncGenerateVideoReferenceImages`, `BatchAsyncGenerateVideoText`, and `BatchAsyncGenerateVideoUpsampleVideo`. A serialization helper mentions `videoModelKey`, `aspectRatio`, `count`, `structuredPrompt`, `inputFrames`, `referenceImages` and `baseVideoId`. These are static implementation observations, not proof of live HTTP routes, accepted payloads or authorization requirements. No adapter calls or guessed backend model IDs were implemented from them. Video editing candidates also exist in the bundle and are outside this project's scope.

A repeated scenario encountered a settings-button timeout during reload, followed by a passive `Debugger.enable` timeout. Restarting only the dedicated Chrome process tree restored CDP access and retained sign-in. Stopping its parent alone left children behind and caused the first restart to fail; the stop helper now includes Chrome descendants of the verified profile process. The bridge must wait for application readiness and preserve step failures rather than report a cancelled action as successful. No failed scenario was retried as a generation.

## Prepared generation test

After recovery, REA prepared a text-only draft with **Omni 1.1 Flash, Ingredients, 9:16, 360p, 4 seconds, x1**. All declared preparation actions completed, Start generation was enabled, and Flow quoted **4 credits** (`prepared-final-test-capture.json`, evidence `ev_1341dd2384d14a76c81c6298c482f75436563f07f1ed738eb0e9ded17a28b3ed`). At preparation, no generation was submitted. The prompt describes a paper robot waving once on a desk, without text or speech; it is an isolated diagnostic draft, not an application character or default prompt.

The user subsequently authorized this single 4-credit test and a zero-cost upscale. It does not verify first/last-frame uploads or voice generation, which need separate valid visual-reference jobs. The actual account pricing and enabled download menu were checked before submitting upscale.

On browser restart the composer returned to Image mode with x2 outputs. The adapter must explicitly reapply and verify every video setting before submission; project URL and persisted sign-in do not guarantee persisted generation preferences.

## Completed authorized test

The first output-count guard used a Playwright `:text-is()` selector on a button whose text was nested in spans. It failed before the submit step, which was cancelled. The guard was corrected to inspect the checked radio with `:has-text()`. Evidence confirmed no prior submission before proceeding; the paid generation was clicked exactly once. An implementation must reconcile these distinct outcomes rather than retry an ambiguous submission.

| Operation          | Verified result                                                                                                                    | Evidence                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Generate           | Omni 1.1 Flash, 4 seconds, 360p, portrait, x1, 4-credit quote; one submission accepted                                             | `submitted-test-corrected-capture.json`, `ev_2b800910f4b3f2d662221c19dd4f84078716dfdc10e7128d6e71ff7e4e06a4f9`         |
| Original download  | HTTP 200, 309,474-byte MP4; 360 x 640, 24 fps, H.264/AAC, 4.011 seconds                                                            | `download-original-capture.json`, `ev_e25558fcf973b05e2b22382b1c3b2cbe794ee790f1018a4688cda2be1eede1e8`; local FFprobe |
| Upscale pricing    | Live GetModels entry `omni_upsampler_360p` has zero cost for eligible paid tiers; the enabled 720p menu showed no credit surcharge | `download-options-capture.json`, `ev_6b245c1a3d61464faa76d0ffdd99c72a744e8741e9fa5684f801e4051d4770c9`                 |
| Upscale            | One accepted upscale; returned credit balance unchanged from after generation                                                      | `upscale-start-capture.json`, `ev_826422d2fefc014e6d761a10061b2b26a19605376b109a00827f10fdf4193f8b`                    |
| Upscale completion | Existing derived media record reached state 3, which the captured status decoder maps to success                                   | `post-upscale-options-capture.json`, `ev_0910a7a570250017573e7a7afd0082828b2289b4fcf2c92ea66ac61cef22d727`             |
| Upscale download   | Cached completed result downloaded without another upscale RPC; 715,323-byte MP4; 720 x 1280, 24 fps, H.264/AAC, exactly 4 seconds | `download-upscaled-capture.json`, `ev_999e9e51dd4ac59b1d1892f7cfb22d40c972f6e47e6fd1638ef13477e926084b`; local FFprobe |

Both files are preserved under ignored `.tmp/flow-rea/test-360p.mp4` and `test-720p.mp4`. Total authorized generation cost: **4 Flow credits**; additional upscale cost: **0**. No native 720p generation, voice preview or additional paid generation was submitted. These are synthetic diagnostic clips, not reenactment outputs.

### Observed request contracts

The live web client used form-encoded POST requests to `https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute`, with a `rpcids` query selector and `f.req` containing positional protocol arrays. This is not the official Gemini/Veo API or an OpenAI-compatible endpoint.

| RPC selector | Matched shipped method                                | Observed role                                             |
| ------------ | ----------------------------------------------------- | --------------------------------------------------------- |
| `HTrJv`      | `FlowService.GetModels`                               | Current account model capabilities/prices                 |
| `YhhmEf`     | `VideoFxService.BatchAsyncGenerateVideoText`          | Accepted text-generation request using `abra_t2v_4s_360p` |
| `jwpduf`     | `VideoFxService.BatchCheckAsyncVideoGenerationStatus` | Poll returned media names for generation/upscale progress |
| `p0UkFb`     | `VideoFxService.BatchAsyncGenerateVideoUpsampleVideo` | Accepted 720p upscale request using `omni_upsampler_360p` |

The captured decoder maps 6 to scheduled, 1/2 to pending, 3 to success, 4/7 to failed and 5 to canceled. Media IDs are opaque; the observed upscale used a derived ID ending `_720p_upsampled`. The bridge must retain the ID returned by each operation and never manufacture one from the source ID.

Download selection obtained content from `https://flow-content.google`; the observed result URL successfully downloaded into the workspace without copying browser cookies or authorization headers. These URLs are private, temporary result references and must not be treated as durable public links. An application adapter should save media bytes to its asset store and return local asset references.

The native download handler reuses an existing matching upscale: it waits if that job is pending and downloads it if successful. The cached-result download above made **zero** additional `p0UkFb` calls. Preserve that behavior rather than submit upscale again when a download is retried.

Generation and upscale requests included browser-generated verification context. Capturing these requests does not establish that independent replay will work. Both the investigation and the new adapter operate Flow's native UI, without bypassing verification. Browserless authentication and a 9router-style login inside Recast are not implemented. See the API guide for supported controls and recovery behavior.

REA's default body budgets omitted the full original MP4 and later the upscale body (allocation limit). These are documented incomplete body captures, not missing generation results. The actual observed download URLs were used to save and independently probe the files. Raw network bodies, temporary result URLs and verification values stay local and ignored.
