from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    llm_provider: str = os.getenv("LLM_PROVIDER", "mock").lower()
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    groq_timeout_seconds: float = float(os.getenv("GROQ_TIMEOUT_SECONDS", "6"))
    deepgram_api_key: str = os.getenv("DEEPGRAM_API_KEY", "")
    deepgram_model: str = os.getenv("DEEPGRAM_MODEL", "nova-3")
    deepgram_language: str = os.getenv("DEEPGRAM_LANGUAGE", "en-US")
    confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.75"))
    window_seconds: int = int(os.getenv("WINDOW_SECONDS", "30"))
    max_buffer_sentences: int = int(os.getenv("MAX_BUFFER_SENTENCES", "20"))
    duplicate_cooldown_seconds: int = int(os.getenv("DUPLICATE_COOLDOWN_SECONDS", "8"))

    penalty_ad_hominem: int = int(os.getenv("PENALTY_AD_HOMINEM", "8"))
    penalty_straw_man: int = int(os.getenv("PENALTY_STRAW_MAN", "7"))
    penalty_false_dilemma: int = int(os.getenv("PENALTY_FALSE_DILEMMA", "6"))
    penalty_circular_reasoning: int = int(os.getenv("PENALTY_CIRCULAR_REASONING", "6"))
    penalty_slippery_slope: int = int(os.getenv("PENALTY_SLIPPERY_SLOPE", "5"))
    penalty_red_herring: int = int(os.getenv("PENALTY_RED_HERRING", "5"))

    @property
    def penalties(self) -> dict[str, int]:
        return {
            "Ad Hominem": self.penalty_ad_hominem,
            "Straw Man": self.penalty_straw_man,
            "False Dilemma": self.penalty_false_dilemma,
            "Circular Reasoning": self.penalty_circular_reasoning,
            "Slippery Slope": self.penalty_slippery_slope,
            "Red Herring": self.penalty_red_herring,
            "None": 0,
        }


settings = Settings()
