from __future__ import annotations

import asyncio
import json
from urllib.parse import urlencode

import websockets

from .config import settings


class DeepgramStreamingError(RuntimeError):
    pass


class DeepgramStream:
    """Backend bridge: browser PCM16 -> Deepgram live STT WebSocket."""

    def __init__(self) -> None:
        if not settings.deepgram_api_key:
            raise DeepgramStreamingError("DEEPGRAM_API_KEY is not configured")
        self.ws = None
        self.reader_task: asyncio.Task | None = None
        self.pending_final: list[str] = []
        self.running = False
        self.speaker = "Speaker A"

    async def start(self, speaker: str, on_message):
        self.speaker = speaker
        params = {
            "model": settings.deepgram_model,
            "language": settings.deepgram_language,
            "encoding": "linear16",
            "sample_rate": 16000,
            "channels": 1,
            "smart_format": "true",
            "punctuate": "true",
            "interim_results": "true",
            "endpointing": 400,
            "utterance_end_ms": 1000,
            "vad_events": "true",
        }
        uri = "wss://api.deepgram.com/v1/listen?" + urlencode(params)
        self.ws = await websockets.connect(
            uri,
            additional_headers={"Authorization": f"Token {settings.deepgram_api_key}"},
            max_size=8 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        )
        self.running = True
        self.reader_task = asyncio.create_task(self._reader(on_message))

    async def send_audio(self, data: bytes) -> None:
        if self.running and self.ws is not None:
            await self.ws.send(data)

    async def stop(self) -> None:
        if self.ws is None:
            return
        try:
            await self.ws.send(json.dumps({"type": "CloseStream"}))
        except Exception:
            pass
        self.running = False
        try:
            await self.ws.close()
        except Exception:
            pass
        if self.reader_task:
            try:
                await asyncio.wait_for(self.reader_task, timeout=1.5)
            except Exception:
                self.reader_task.cancel()
        self.reader_task = None
        self.ws = None
        self.pending_final.clear()

    async def _reader(self, on_message) -> None:
        assert self.ws is not None
        try:
            async for raw in self.ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._handle_message(msg, on_message)
        except Exception as exc:
            await on_message({"type": "stt_error", "message": str(exc)})

    async def _flush_pending(self, on_message) -> None:
        utterance = " ".join(self.pending_final).strip()
        self.pending_final.clear()
        if utterance:
            await on_message({
                "type": "finished_utterance",
                "speaker": self.speaker,
                "text": utterance,
            })

    async def _handle_message(self, msg: dict, on_message) -> None:
        msg_type = msg.get("type")
        if msg_type == "SpeechStarted":
            await on_message({"type": "speech_started", "speaker": self.speaker})
            return
        if msg_type == "UtteranceEnd":
            # Fallback end-of-sentence signal: in noisy rooms speech_final may never
            # arrive, so flush whatever finalized text we are holding.
            await self._flush_pending(on_message)
            return
        if msg_type == "Metadata" or "channel" not in msg:
            return

        is_final = bool(msg.get("is_final"))
        speech_final = bool(msg.get("speech_final"))
        alternatives = msg.get("channel", {}).get("alternatives", [])
        transcript = ((alternatives[0].get("transcript") if alternatives else "") or "").strip()

        if not transcript:
            # speech_final can arrive on an empty-transcript message; don't drop it.
            if speech_final:
                await self._flush_pending(on_message)
            return

        if is_final:
            self.pending_final.append(transcript)

        await on_message({
            "type": "transcript",
            "speaker": self.speaker,
            "text": transcript,
            "final": is_final,
            "speech_final": speech_final,
        })

        if speech_final:
            await self._flush_pending(on_message)
