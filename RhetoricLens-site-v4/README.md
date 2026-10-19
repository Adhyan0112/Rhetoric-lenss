# RhetoricLens

**Hear the words. See the structure.** RhetoricLens is a real-time logical-fallacy analysis prototype with a separate Rhetorical Rigor Score for each speaker. This project includes a cinematic, scroll-reactive landing page built with the existing HTML/CSS/JavaScript stack and the analysis console.

## Run locally

```bash
python -m venv .venv
```

Windows:

```bat
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000` for the product site, or `http://127.0.0.1:8000/app` for the analysis console. The no-key scripted demo is available with `LLM_PROVIDER=mock`. For live classification, configure `LLM_PROVIDER=groq` and `GROQ_API_KEY`. Live microphone transcription uses Deepgram and requires `DEEPGRAM_API_KEY`.

## What the console does

- Analyzes typed text, live microphone speech, or uploaded audio/video.
- Supports English and Hindi speech transcription.
- Checks finished sentences against six fallacy types: Ad Hominem, Straw Man, False Dilemma, Circular Reasoning, Slippery Slope, and Red Herring.
- Displays a quoted phrase, brief explanation, timestamp, point change, transcript history, flag timeline, and per-speaker score.
- Includes scripted scenarios for rehearsals without API keys.

The **Play demo** scenario resets the console, then runs a short debate with Speaker A and Speaker B taking turns. Scripted lines use the deterministic provider through the same server-side quote validation and score engine, so the demo can show its example flags even when live AI mode is configured.

The classifier proposes a finding; server-side validation checks confidence, quote presence and length, explanation length, and duplicates. The server owns scoring. Detection is imperfect, only six fallacy types are covered, and configurable penalty weights are not scientifically validated. Flags are cues for inspection, not verdicts about truth or who is right.

## Architecture

Python and FastAPI serve a plain HTML/CSS/JavaScript interface. Live microphone audio is sent over WebSockets to Deepgram streaming speech-to-text. Uploaded audio/video is transcribed with speaker labels. A rolling 30-second conversation buffer provides context to the structured Groq classifier; the server validates proposed flags and computes scores before updating the dashboard.

The app needs a persistent server for its WebSocket endpoint. Serverless hosts without WebSocket support will not run the live console.
