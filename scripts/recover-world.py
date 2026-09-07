#!/usr/bin/env python3
"""Re-runs the station's own hand model over a debug recording and keeps what the
app was throwing away until ADR 0021: the world landmarks.

Takes recorded before that ADR carry 2D landmarks only. This reads the .webm,
which is the unmirrored camera image the detectors were handed, runs the same
gesture_recognizer.task over every frame, and writes one JSON per take with
2D landmarks (mirrored, like the trace), world landmarks (metres, x negated to
match) and the gesture label. Numbers only: nothing here writes an image, and
the output stays beside the recordings, gitignored.

Needs Python 3.12 with mediapipe and opencv-python-headless; the station's own
Python is newer than mediapipe supports, so use a venv:

    uv venv --python 3.12 .venv-mp
    uv pip install --python .venv-mp/bin/python mediapipe opencv-python-headless
    .venv-mp/bin/python scripts/recover-world.py recordings/world recordings/*.webm

Then `node scripts/pinch-rulers.mjs <take>.json recordings/world/<take>.json`
replays the gate on both rulers. See docs/adr/0021-the-pinch-is-limited-by-pixels.md.
"""
import json
import os
import sys
import time

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL = os.environ.get("GR_MODEL", "public/models/gesture_recognizer.task")


def recover(webm: str, out_path: str) -> None:
    cap = cv2.VideoCapture(webm)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {webm}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    options = vision.GestureRecognizerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    frames = []
    started = time.time()
    with vision.GestureRecognizer.create_from_options(options) as recognizer:
        index = 0
        last_ts = -1
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            # MediaRecorder's WebM has no reliable frame count; the position the
            # decoder reports is the truth, with a fallback to the nominal rate.
            pos = cap.get(cv2.CAP_PROP_POS_MSEC)
            ms = pos if pos and pos > 0 else index * 1000.0 / fps
            # MediaPipe throws on a timestamp that does not increase.
            ts = max(int(round(ms)), last_ts + 1)
            last_ts = ts
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            result = recognizer.recognize_for_video(image, ts)
            entry = {"ms": round(ms, 1), "hand": None}
            if result.hand_landmarks:
                gesture = result.gestures[0][0] if result.gestures and result.gestures[0] else None
                entry["hand"] = {
                    # The one flip, the way src/perception/mirror.ts does it.
                    "landmarks": [[round(1 - p.x, 4), round(p.y, 4), round(p.z, 4)] for p in result.hand_landmarks[0]],
                    "world": [[round(-p.x, 4), round(p.y, 4), round(p.z, 4)] for p in result.hand_world_landmarks[0]],
                    "gesture": gesture.category_name if gesture else "None",
                    "confidence": round(gesture.score, 4) if gesture else 0,
                }
            frames.append(entry)
            index += 1
    cap.release()
    with open(out_path, "w", encoding="utf8") as out:
        json.dump({"source": os.path.basename(webm), "fps": fps, "frames": frames}, out)
    with_hand = sum(1 for f in frames if f["hand"])
    print(f"{os.path.basename(webm)}: {len(frames)} frames, {with_hand} with a hand, {time.time() - started:.0f}s")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: recover-world.py <out-dir> <recording.webm>...")
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    for webm in sys.argv[2:]:
        recover(webm, os.path.join(out_dir, os.path.basename(webm)[: -len(".webm")] + ".json"))
