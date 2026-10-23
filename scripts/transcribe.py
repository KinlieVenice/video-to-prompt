"""Install with: python -m pip install -r scripts/requirements-whisper.txt."""
import json
import os
import sys

try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.stderr.write("Install faster-whisper in the configured Python environment.\n")
    sys.exit(2)

# A multilingual model is required for Filipino and Taglish; never use an .en model.
model = WhisperModel(
    os.environ.get("STUDIO_WHISPER_MODEL", "small"),
    device=os.environ.get("STUDIO_WHISPER_DEVICE", "cpu"),
    compute_type=os.environ.get("STUDIO_WHISPER_COMPUTE_TYPE", "int8"),
)
language = None if sys.argv[2] == "auto" else sys.argv[2]
segments, _ = model.transcribe(
    sys.argv[1], language=language, task="transcribe", beam_size=5,
    vad_filter=True, word_timestamps=True,
)
result = [
    {"start": s.start, "end": s.end, "text": s.text.strip()}
    for s in segments if s.text.strip()
]
sys.stdout.buffer.write(json.dumps({"segments": result}, ensure_ascii=False).encode("utf-8"))
