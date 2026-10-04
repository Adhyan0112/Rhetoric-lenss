# RhetoricLens Prototype v3

A hackathon-ready prototype for **real-time logical fallacy detection** with a running **Rhetorical Rigor Score**.

## What changed in v3

- Real LLM mode via **Groq Structured Outputs** using `openai/gpt-oss-20b` by default.
- Conservative classifier prompt designed for **precision over recall**.
- Session-level 30-second rolling context across speakers, so context-sensitive fallacies have conversational history.
- Deterministic server validation: confidence gate, quote verification, quote length, explanation length, and duplicate suppression.
- Server-owned scoring remains separate from the model's proposed verdict.
- Added adversarial unit tests for false-positive resistance and hallucinated quotes.
- Live microphone → Deepgram streaming STT from v2 remains available.

## Run locally

### 1. Create environment

```bash
python -m venv .venv
```

Windows:

```bat
.venv\\Scripts\\activate
```

macOS/Linux:

```bash
source .venv/bin/activate
```

### 2. Install

```bash
pip install -r requirements.txt
```

### 3. Configure

Copy `.env.example` to `.env`.

No-key deterministic demo:

```env
LLM_PROVIDER=mock
```

Real LLM:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_MODEL=openai/gpt-oss-20b
```

Live microphone → Deepgram:

```env
DEEPGRAM_API_KEY=your_key_here
DEEPGRAM_MODEL=nova-3
DEEPGRAM_LANGUAGE=en-US
```

### 4. Start

```bash
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000

## Demo flow

1. Click **Start microphone** and allow browser microphone access.
2. Speak: `You don't understand economics, so your argument is meaningless.`
3. Watch the transcript finalize, then the Ad Hominem alert and score drop.
4. Speak an aggressive but structurally ordinary sentence to show **NO FLAG**.
5. Try the built-in scripted scenarios for a reliable rehearsal.

## Real LLM mode

Switch `.env` to:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b
```

The model returns only the structured verdict. The server still decides whether the event is accepted and how many points are deducted.

## Architecture

```text
Browser microphone
        |
        | PCM16 / 16k
        v
FastAPI WebSocket
        |
        v
Deepgram streaming STT
        | finalized utterance
        v
30s rolling conversation buffer
        |
        v
Structured LLM classifier
        |
        v
Validation Gate
  - confidence >= threshold
  - quote exists in transcript
  - 3-8 quote words
  - explanation < 12 words
  - duplicate suppression
        |
        v
Deterministic Score Engine
        |
        v
WebSocket Detection Event
        |
        v
RhetoricLens HUD
```

## Precision test suite

Run:

```bash
pytest -q
```

The tests cover:

- Real Ad Hominem positive.
- Aggressive but not structurally fallacious sentence.
- Hallucinated quote rejected server-side.
- Duplicate flag suppressed.

## Current six-fallacy taxonomy

- Ad Hominem −8
- Straw Man −7
- False Dilemma −6
- Circular Reasoning −6
- Slippery Slope −5
- Red Herring −5

These weights match the current submitted deck and are configurable values, not scientifically validated measurements.
