from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles

from .deepgram_stream import DeepgramStream, DeepgramStreamingError
from .engine import RhetoricEngine
from .models import AnalyzeRequest
from .providers import get_provider
from .config import settings

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="RhetoricLens Prototype", version="0.1.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

provider = get_provider()
engine = RhetoricEngine(provider)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "provider": provider.__class__.__name__,
        "time": time.time(),
    }


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    return engine.analyze(req.speaker, req.text, req.timestamp).model_dump()


@app.post("/api/reset")
def reset():
    engine.reset()
    return {"ok": True}


@app.get("/api/state")
def state():
    return engine.snapshot()


@app.get("/api/config")
def runtime_config():
    return {
        "provider": provider.__class__.__name__,
        "window_seconds": settings.window_seconds,
        "confidence_threshold": settings.confidence_threshold,
        "deepgram_configured": bool(settings.deepgram_api_key),
        "groq_configured": bool(settings.groq_api_key),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    dg: DeepgramStream | None = None

    async def handle_stt_message(msg: dict) -> None:
        if msg.get("type") == "finished_utterance":
            speaker = msg.get("speaker", "Speaker A")
            text = msg.get("text", "")
            if not text:
                return
            event = await asyncio.to_thread(engine.analyze, speaker, text, time.time())
            await websocket.send_json({"type": "detection", "data": event.model_dump()})
        else:
            await websocket.send_json(msg)

    try:
        await websocket.send_json({"type": "state", "data": engine.snapshot()})
        while True:
            message = await websocket.receive()
            if message.get("text") is not None:
                payload = json.loads(message["text"])
                kind = payload.get("type")
                if kind == "analyze":
                    req = AnalyzeRequest.model_validate(payload.get("data", {}))
                    event = await asyncio.to_thread(
                        engine.analyze, req.speaker, req.text, req.timestamp
                    )
                    await websocket.send_json({"type": "detection", "data": event.model_dump()})
                elif kind == "audio_start":
                    speaker = payload.get("speaker", "Speaker A")
                    if dg is not None:
                        await dg.stop()
                    try:
                        dg = DeepgramStream()
                        await dg.start(speaker=speaker, on_message=handle_stt_message)
                        await websocket.send_json({"type": "audio_status", "status": "started", "provider": "deepgram"})
                    except DeepgramStreamingError as exc:
                        dg = None
                        await websocket.send_json({"type": "audio_status", "status": "error", "message": str(exc)})
                elif kind == "audio_stop":
                    if dg is not None:
                        await dg.stop()
                        dg = None
                    await websocket.send_json({"type": "audio_status", "status": "stopped"})
                elif kind == "reset":
                    engine.reset()
                    await websocket.send_json({"type": "state", "data": engine.snapshot()})
                elif kind == "ping":
                    await websocket.send_json({"type": "pong", "t": time.time()})
                else:
                    await websocket.send_json({"type": "error", "message": "Unknown message type"})
            elif message.get("bytes") is not None:
                if dg is not None:
                    await dg.send_audio(message["bytes"])
    except WebSocketDisconnect:
        if dg is not None:
            await dg.stop()
    except RuntimeError as exc:
        # Starlette may surface a second receive() error after a client disconnects.
        if "disconnect message" not in str(exc).lower():
            if dg is not None:
                await dg.stop()
            raise
        if dg is not None:
            await dg.stop()
    except Exception:
        if dg is not None:
            await dg.stop()
        raise
