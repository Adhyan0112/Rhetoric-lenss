import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.deepgram_stream import DeepgramStream


def _stream() -> DeepgramStream:
    # Bypass __init__ so no API key is needed; only the message handler is tested.
    s = DeepgramStream.__new__(DeepgramStream)
    s.pending_final = []
    s.speaker = "Speaker A"
    return s


def _result(text, is_final=True, speech_final=False):
    return {
        "channel": {"alternatives": [{"transcript": text}]},
        "is_final": is_final,
        "speech_final": speech_final,
    }


def _run(stream, messages):
    out = []

    async def collect(msg):
        out.append(msg)

    async def go():
        for m in messages:
            await stream._handle_message(m, collect)

    asyncio.run(go())
    return [m["text"] for m in out if m["type"] == "finished_utterance"]


def test_speech_final_flushes_utterance():
    s = _stream()
    done = _run(s, [_result("Hello there", speech_final=True)])
    assert done == ["Hello there"]


def test_utterance_end_flushes_when_speech_final_never_arrives():
    s = _stream()
    done = _run(s, [_result("You are wrong"), {"type": "UtteranceEnd"}])
    assert done == ["You are wrong"]


def test_empty_transcript_speech_final_still_flushes():
    s = _stream()
    done = _run(s, [_result("First part"), _result("", is_final=True, speech_final=True)])
    assert done == ["First part"]


def test_no_duplicate_when_both_signals_arrive():
    s = _stream()
    done = _run(s, [_result("One sentence", speech_final=True), {"type": "UtteranceEnd"}])
    assert done == ["One sentence"]
