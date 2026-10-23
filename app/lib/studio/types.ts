export type AudioMode = "ORIGINAL" | "CHARACTER_TTS" | "UPLOADED" | "SILENT";
export type Strategy =
  "FRAMES" | "FIRST_LAST" | "INGREDIENTS" | "EXTEND" | "ANIMATION_2D";
export type Target = "VEO_LITE" | "OMNI_FLASH";
export type Interval = { start: number; end: number };
export type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};
export type MotionBeat = Interval & {
  id: string;
  action: string;
  phase: "SETUP" | "ACTION" | "REACTION" | "RECOVERY" | "HOLD";
  importance: "KEY" | "NORMAL";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidenceTimes: number[];
  anchorTime: number;
  frameAsset?: string;
  reviewed: boolean;
  timingKind?: "ACTIVITY" | "TRANSITION" | "OBSERVATION";
  onset?: Interval;
  continuing?: boolean;
  settled?: boolean;
  stateBefore?: string;
  stateAfter?: string;
  evidence?: {
    before: { time: number; asset: string };
    after: { time: number; asset: string };
  };
  timingNotes?: string[];
};
export type ContinuityState = {
  pose: string;
  hands: string;
  objects: string;
  ongoingAction: string;
  settled: boolean;
};
export type MotionWindowState = Interval & {
  state: ContinuityState;
  frameTime: number;
  frameAsset: string;
};
export type MotionSampling = {
  version: 2 | 3;
  times: number[];
  windows: number;
  requests: number;
  maxGap: number;
};
export type Shot = Interval & {
  id: string;
  description: string;
  camera: string;
  motion: string;
  lighting: string;
  motionBeats?: MotionBeat[];
  motionSampling?: MotionSampling;
  motionWindows?: MotionWindowState[];
};
export type Speaker = { id: string; name: string; description: string };
export type Turn = Interval & {
  id: string;
  speakerId: string;
  text: string;
  emotion: string;
  gesture: string;
  reviewed: boolean;
};
export type Analysis = {
  id: string;
  sourceAsset: string;
  sourceName: string;
  sourceHash: string;
  media: MediaInfo;
  shots: Shot[];
  speakers: Speaker[];
  turns: Turn[];
  activity: Interval[];
  status: "LOCAL" | "ANALYZED";
  model?: string;
  provider?: "OPENAI_9ROUTER";
  warnings: string[];
  createdAt: string;
  revision: number;
};
export type VoiceProfile = {
  provider: "OPENAI" | "GEMINI";
  model: string;
  kind: "PREBUILT" | "DESIGNED";
  voiceId: string;
  language: "auto" | "fil-PH" | "en-US";
  style: string;
  speed: number;
  designPrompt: string;
  previewAsset?: string;
};
export type Character = {
  id: string;
  name: string;
  description: string;
  visualStyle: string;
  references: string[];
  voice: VoiceProfile;
  updatedAt: string;
};
export type AudioTake = {
  asset: string;
  duration: number;
  signature: string;
  createdAt: string;
  inputFingerprint?: string;
};
export type TurnTiming = { offset: number; speed: number };
export type Segment = Interval & {
  id: string;
  shotId: string;
  duration: number;
  overlap: number;
  strategy: Strategy;
  continuationOf?: string;
  credits: number;
  warnings: string[];
};
export type Frames = {
  first: string;
  last: string;
  moments?: { beatId: string; time: number; asset: string; action: string }[];
  generated?: {
    first: string;
    last: string;
    signature: string;
    inheritedFrom?: { segmentId: string; signature: string; asset: string };
  };
};
export type ImportedClip = { asset: string; media: MediaInfo; trim: number };
export type VisualDirection = {
  backgroundMode: "SOURCE" | "NEW";
  backgroundPrompt: string;
  expression: "MATCH_SOURCE" | "SUBTLE" | "EXPRESSIVE";
  completeScene?: boolean;
};
export type Version = {
  id: string;
  name: string;
  sourceRange?: Interval;
  visualDirection?: VisualDirection;
  mappings: Record<string, string>;
  appearanceNotes?: Record<string, string>;
  audioMode: AudioMode;
  uploadedAudio?: string;
  backgroundAudio?: string;
  audioOffset: number;
  audioTakes: Record<string, AudioTake[]>;
  selectedTakes: Record<string, string>;
  turnTiming: Record<string, TurnTiming>;
  target: Target;
  maxDuration: number;
  overlap: number;
  strategy: Strategy;
  ultra: boolean;
  creditOverride?: number;
  segments: Segment[];
  planRevision?: number;
  frames: Record<string, Frames>;
  clips: Record<string, ImportedClip>;
  aspect: "9:16" | "16:9";
  subtitles: boolean;
  disclosure: boolean;
  exportAsset?: string;
  exportSignature?: string;
};
export type Project = {
  id: string;
  name: string;
  analysisId: string;
  versions: Version[];
  updatedAt: string;
};
export type StudioState = {
  projects: Project[];
  analyses: Analysis[];
  characters: Character[];
};

export const TTS_MODELS = [
  "openai/gpt-4o-mini-tts",
  "openai/tts-1",
  "openai/tts-1-hd",
];
export const IMAGE_MODELS = ["cx/gpt-image-2"];
export const STRATEGIES: Record<Strategy, string> = {
  FRAMES: "Frames to video",
  FIRST_LAST: "First + last frame",
  INGREDIENTS: "Ingredients / references",
  EXTEND: "Veo Lite extension",
  ANIMATION_2D: "Reusable 2D animation",
};
export function defaultVoice(): VoiceProfile {
  return {
    provider: "OPENAI",
    model: TTS_MODELS[0],
    kind: "PREBUILT",
    voiceId: "alloy",
    language: "auto",
    style: "",
    speed: 1,
    designPrompt: "",
  };
}
export function speechInput(turn: Turn, voice: VoiceProfile) {
  return {
    text: turn.text,
    emotion: turn.emotion,
    voice: {
      provider: voice.provider,
      model: voice.model,
      voiceId: voice.voiceId,
      language: voice.language,
      style: voice.style,
    },
  };
}
export function newVersion(id: string, name = "Version 1"): Version {
  return {
    id,
    name,
    visualDirection: {
      backgroundMode: "SOURCE",
      backgroundPrompt: "",
      expression: "SUBTLE",
      completeScene: true,
    },
    mappings: {},
    appearanceNotes: {},
    audioMode: "ORIGINAL",
    audioOffset: 0,
    audioTakes: {},
    selectedTakes: {},
    turnTiming: {},
    target: "VEO_LITE",
    maxDuration: 8,
    overlap: 0,
    strategy: "FIRST_LAST",
    ultra: false,
    segments: [],
    frames: {},
    clips: {},
    aspect: "16:9",
    subtitles: false,
    disclosure: false,
  };
}
export const assetUrl = (asset: string) =>
  `/api/assets/${encodeURIComponent(asset)}`;
export const seconds = (value: number) => `${value.toFixed(2)}s`;
