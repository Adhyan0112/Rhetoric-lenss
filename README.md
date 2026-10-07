# RhetoricLens

Real-time logical-fallacy detection with a running **Rhetorical Rigor Score**.
Built for HackCosmic (AI for Real-World Impact).

> Hear the words. See the structure.

RhetoricLens listens to live speech, flags structural fallacies from a fixed
six-item taxonomy, and keeps a per-speaker rigor score. It is deliberately
**precision-first**: the LLM proposes a verdict, but the server only accepts it
if the quote really appears in the transcript, the confidence clears a
threshold, and the explanation is short. The server, not the model, owns scoring.

## Where the code lives

The runnable app is in [`RhetoricLens_Prototype_v2/rl_v3`](RhetoricLens_Prototype_v2/rl_v3).
See its README for full setup, architecture, and the demo script.

## Quick start

```bash
cd RhetoricLens_Prototype_v2/rl_v3
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000. With `LLM_PROVIDER=mock` no keys are needed (scripted
rehearsal mode). For real analysis set `LLM_PROVIDER=groq` and a `GROQ_API_KEY`.

## Tests

```bash
cd RhetoricLens_Prototype_v2/rl_v3
pytest -q
```

## Notes

- The app needs a persistent server for its WebSocket (`/ws`). Serverless hosts
  such as Vercel do not support this; run locally or use a host that does.
- Fallacy penalty weights are configurable values, not scientifically validated.

**Live demo:** https://rhetoric-lenss.onrender.com (free tier, first load may take about a minute)

