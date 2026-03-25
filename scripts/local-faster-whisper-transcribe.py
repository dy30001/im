#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Local faster-whisper transcription bridge for codex-im")
    parser.add_argument("--audio", required=True, help="Absolute path to audio file")
    parser.add_argument("--model", default="base", help="faster-whisper model size")
    parser.add_argument("--language", default="", help="Optional language code, e.g. zh")
    parser.add_argument("--compute-type", default="int8", help="faster-whisper compute type")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise RuntimeError(
            "faster-whisper is not installed. Run: pip install faster-whisper ffmpeg-python"
        ) from exc

    model = WhisperModel(args.model, compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.audio,
        language=args.language or None,
        vad_filter=False,
    )

    text = "".join(segment.text for segment in segments).strip()
    payload = {
        "text": text,
        "language": getattr(info, "language", "") or "",
        "duration": float(getattr(info, "duration", 0.0) or 0.0),
        "duration_after_vad": float(getattr(info, "duration_after_vad", 0.0) or 0.0),
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(str(error))
        sys.exit(1)
