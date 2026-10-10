from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod

from .config import settings
from .models import FallacyType, ModelVerdict


TAXONOMY = {
    "Ad Hominem": "attacks a person instead of addressing the substantive claim",
    "Straw Man": "misrepresents or exaggerates the opponent's actual position",
    "False Dilemma": "presents two options as exhaustive when meaningful alternatives exist",
    "Circular Reasoning": "uses the conclusion as its own support",
    "Slippery Slope": "claims a chain of extreme outcomes without enough causal support",
    "Red Herring": "diverts from the core claim to an unrelated issue",
}

SYSTEM_PROMPT = """
You are RhetoricLens, a conservative real-time argument-structure classifier.
Your job is NOT to fact-check truth, political ideology, tone, intelligence, or whether
someone is rude. Detect ONLY formal structural fallacies from this fixed taxonomy:
Ad Hominem, Straw Man, False Dilemma, Circular Reasoning, Slippery Slope, Red Herring.

PRECISION OVER RECALL:
If the evidence is incomplete, sarcastic, ambiguous, or depends on missing context,
return no fallacy. Never infer a fallacy merely from aggressive wording.

Rules:
- Return one verdict for the CURRENT utterance.
- quote must be an exact contiguous 3-8 word span from the CURRENT utterance.
- explanation must contain fewer than 12 words.
- Never invent quote text.
- The utterance may be in ANY language, or a mix such as Hinglish. Copy the quote verbatim in its original language and script. Write the explanation in English.
- Do not treat insults, emotion, disagreement, confidence, or sarcasm as fallacies by themselves.
- Ad Hominem: the personal attack replaces engagement with the claim.
- Straw Man: an identifiable opponent position is distorted or exaggerated into an easier target.
- False Dilemma: two choices are presented as exhaustive when meaningful alternatives exist.
- Circular Reasoning: the conclusion is reused as its own support.
- Slippery Slope: a chain toward an extreme consequence is asserted without adequate causal support.
- Red Herring: the speaker diverts away from the active issue instead of addressing it.
- Use the recent context only to understand what the current utterance responds to.
- A valid argument with rude language can still receive NO FLAG.
"""


class Provider(ABC):
    @abstractmethod
    def classify(self, text: str, context: str) -> ModelVerdict:
        raise NotImplementedError


class MockProvider(Provider):
    """Deterministic provider for rehearsals and no-key fallback."""

    def classify(self, text: str, context: str) -> ModelVerdict:
        t = (
            text.lower()
            .strip()
            .replace("’", "'")
            .replace("‘", "'")
            .replace("“", '"')
            .replace("”", '"')
        )
        rules: list[tuple[FallacyType, list[str], float, str]] = [
            (
                FallacyType.AD_HOMINEM,
                ["you don't understand", "you are too stupid", "you're too stupid", "you're not qualified"],
                0.95,
                "Attacks the person instead of addressing the argument.",
            ),
            (
                FallacyType.FALSE_DILEMMA,
                ["either ", "or everything fails", "only two choices", "no other option"],
                0.92,
                "Frames limited choices as exhaustive without enough justification.",
            ),
            (
                FallacyType.STRAW_MAN,
                ["so you want to ban everything", "so basically you want", "you just want to"],
                0.91,
                "Recasts the opponent's position into an easier target.",
            ),
            (
                FallacyType.SLIPPERY_SLOPE,
                ["next we'll", "then everyone will", "this will inevitably lead", "soon we'll"],
                0.88,
                "Asserts an unsupported chain toward an extreme outcome.",
            ),
            (
                FallacyType.CIRCULAR_REASONING,
                ["because it is true", "it's true because it is true", "by definition it's correct"],
                0.87,
                "Uses the conclusion as if it were independent evidence.",
            ),
            (
                FallacyType.RED_HERRING,
                ["let's talk about something else", "the real issue is"],
                0.82,
                "Shifts attention away from the claim being discussed.",
            ),
        ]
        for fallacy, patterns, confidence, explanation in rules:
            for pattern in patterns:
                if pattern in t:
                    quote = self._extract_quote(text, pattern)
                    return ModelVerdict(
                        fallacy_detected=True,
                        fallacy_type=fallacy,
                        quote=quote,
                        explanation=explanation,
                        confidence=confidence,
                        argument_claim=text[:160],
                    )
        return ModelVerdict(
            fallacy_detected=False,
            fallacy_type=FallacyType.NONE,
            quote="",
            explanation="No high-confidence structural fallacy detected.",
            confidence=0.96,
            argument_claim=text[:160],
        )

    @staticmethod
    def _extract_quote(text: str, pattern: str) -> str:
        words = re.findall(r"\S+", text)
        pwords = re.findall(r"\S+", pattern)
        size = max(3, min(8, len(pwords)))
        for i in range(len(words)):
            candidate = " ".join(words[i : i + size])
            if pattern.strip().lower() in candidate.lower():
                return candidate.strip(" ,.!?;:")
        return " ".join(words[: min(8, max(3, len(words)))])


class GroqProvider(Provider):
    def __init__(self) -> None:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")
        from openai import OpenAI

        self.client = OpenAI(
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
            timeout=settings.groq_timeout_seconds,
            max_retries=1,
        )

    def classify(self, text: str, context: str) -> ModelVerdict:
        schema = {
            "name": "rhetoric_verdict",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "fallacy_detected": {"type": "boolean"},
                    "fallacy_type": {
                        "type": "string",
                        "enum": [
                            "Ad Hominem",
                            "Straw Man",
                            "False Dilemma",
                            "Circular Reasoning",
                            "Slippery Slope",
                            "Red Herring",
                            "None",
                        ],
                    },
                    "quote": {"type": "string"},
                    "explanation": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "argument_claim": {"type": "string"},
                },
                "required": [
                    "fallacy_detected",
                    "fallacy_type",
                    "quote",
                    "explanation",
                    "confidence",
                    "argument_claim",
                ],
                "additionalProperties": False,
            },
        }

        user_content = f"""
RECENT CONTEXT (newest line is last; use only for conversational reference):
{context[-6000:]}

CURRENT UTTERANCE:
{text}

Return the single most conservative verdict for the CURRENT UTTERANCE.
"""

        response = self.client.chat.completions.create(
            model=settings.groq_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0,
            reasoning_effort="low",
            max_completion_tokens=1024,
            response_format={
                "type": "json_schema",
                "json_schema": schema,
            },
        )
        print("FINISH:", response.choices[0].finish_reason, "RAW:", response.choices[0].message.content, flush=True)
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        return ModelVerdict.model_validate(data)


def get_provider() -> Provider:
    if settings.llm_provider == "groq":
        return GroqProvider()
    return MockProvider()
