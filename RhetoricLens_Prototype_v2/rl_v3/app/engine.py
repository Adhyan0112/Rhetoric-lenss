from __future__ import annotations

import hashlib
import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque

from .config import settings
from .models import DetectionEvent, FallacyType, ModelVerdict
from .providers import Provider

logger = logging.getLogger(__name__)


@dataclass
class BufferedUtterance:
    timestamp: float
    speaker: str
    text: str


class RhetoricEngine:
    """Session-level rolling context + deterministic acceptance/scoring layer."""

    def __init__(self, provider: Provider) -> None:
        self.provider = provider
        self.buffer: Deque[BufferedUtterance] = deque()
        self.scores: dict[str, int] = defaultdict(lambda: 100)
        self.events: list[DetectionEvent] = []
        self._recent_fingerprints: dict[str, float] = {}

    def analyze(self, speaker: str, text: str, timestamp: float | None = None) -> DetectionEvent:
        ts = timestamp if timestamp is not None else time.time()
        text = re.sub(r"\s+", " ", text).strip()
        self._append(speaker, text, ts)

        context = "\n".join(
            f"[{item.speaker}] {item.text}" for item in self.buffer
        )
        verdict, error = self._classify_safely(text, context)
        if error:
            accepted, reason = False, f"Classifier unavailable ({error}); skipped"
        else:
            accepted, reason = self._validate(verdict, text, speaker, ts)

        deduction = 0
        if accepted and verdict.fallacy_detected:
            deduction = settings.penalties.get(verdict.fallacy_type.value, 0)
            self.scores[speaker] = max(0, self.scores[speaker] - deduction)

        event = DetectionEvent(
            accepted=accepted,
            speaker=speaker,
            text=text,
            fallacy_detected=verdict.fallacy_detected,
            fallacy_type=verdict.fallacy_type.value,
            quote=verdict.quote,
            explanation=verdict.explanation,
            confidence=verdict.confidence,
            deduction=deduction,
            new_score=self.scores[speaker],
            timestamp=ts,
            reason=reason,
            argument_claim=verdict.argument_claim,
        )
        self.events.append(event)
        self.events = self.events[-100:]
        return event

    def _classify_safely(self, text: str, context: str) -> tuple[ModelVerdict, str]:
        """Fail open: a provider timeout / bad JSON must never kill the session."""
        try:
            return self.provider.classify(text, context), ""
        except Exception as exc:  # noqa: BLE001 - any provider failure is non-fatal
            logger.warning("Classifier failed: %s: %s", type(exc).__name__, exc)
            return (
                ModelVerdict(
                    fallacy_detected=False,
                    fallacy_type=FallacyType.NONE,
                    quote="",
                    explanation="Classifier unavailable.",
                    confidence=0.0,
                    argument_claim=text[:160],
                ),
                type(exc).__name__,
            )

    def snapshot(self) -> dict:
        return {
            "scores": dict(self.scores),
            "events": [e.model_dump() for e in self.events[-50:]],
            "current_context": {
                speaker: [x.text for x in self.buffer if x.speaker == speaker][-20:]
                for speaker in sorted({x.speaker for x in self.buffer})
            },
        }

    def reset(self) -> None:
        self.buffer.clear()
        self.scores.clear()
        self.events.clear()
        self._recent_fingerprints.clear()

    def _append(self, speaker: str, text: str, ts: float) -> None:
        self.buffer.append(BufferedUtterance(ts, speaker, text))
        cutoff = ts - settings.window_seconds
        while self.buffer and (
            self.buffer[0].timestamp < cutoff
            or len(self.buffer) > settings.max_buffer_sentences
        ):
            self.buffer.popleft()

    def _validate(
        self,
        verdict: ModelVerdict,
        source_text: str,
        speaker: str,
        ts: float,
    ) -> tuple[bool, str]:
        if not verdict.fallacy_detected:
            return False, "No high-confidence structural fallacy detected"
        if verdict.confidence < settings.confidence_threshold:
            return False, "Below confidence threshold"
        if verdict.fallacy_type.value == "None":
            return False, "Invalid fallacy type"
        if not verdict.quote:
            return False, "Missing quote"
        if not _quote_matches(verdict.quote, source_text):
            return False, "Quote does not match transcript"
        words = verdict.quote.split()
        if not 3 <= len(words) <= 8:
            return False, "Quote must contain 3-8 words"
        if len(verdict.explanation.split()) >= 12:
            return False, "Explanation must be fewer than 12 words"

        fingerprint = hashlib.sha1(
            f"{speaker}|{verdict.fallacy_type.value}|{verdict.quote.lower()}".encode("utf-8")
        ).hexdigest()
        previous = self._recent_fingerprints.get(fingerprint)
        if previous is not None and ts - previous < settings.duplicate_cooldown_seconds:
            return False, "Duplicate flag suppressed"
        self._recent_fingerprints[fingerprint] = ts

        # Prevent unbounded growth during long demo sessions.
        cutoff = ts - max(settings.window_seconds, settings.duplicate_cooldown_seconds) * 4
        self._recent_fingerprints = {
            k: v for k, v in self._recent_fingerprints.items() if v >= cutoff
        }
        return True, "Accepted"


def _quote_matches(quote: str, source: str) -> bool:
    """Whitespace/punctuation-tolerant contiguous-span validation."""
    norm_quote = _normalize_for_match(quote)
    norm_source = _normalize_for_match(source)
    return bool(norm_quote) and norm_quote in norm_source


def _normalize_for_match(value: str) -> str:
    value = value.lower().replace("’", "'").replace("‘", "'")
    value = re.sub(r"[^\w\s']", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()
