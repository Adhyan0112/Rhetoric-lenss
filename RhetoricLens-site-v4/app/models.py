from __future__ import annotations

from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field


class Severity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class FallacyType(str, Enum):
    AD_HOMINEM = "Ad Hominem"
    STRAW_MAN = "Straw Man"
    FALSE_DILEMMA = "False Dilemma"
    CIRCULAR_REASONING = "Circular Reasoning"
    SLIPPERY_SLOPE = "Slippery Slope"
    RED_HERRING = "Red Herring"
    NONE = "None"


class AnalyzeRequest(BaseModel):
    speaker: str = Field(default="Speaker A", min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=2000)
    timestamp: float | None = None


class ModelVerdict(BaseModel):
    fallacy_detected: bool
    fallacy_type: FallacyType
    quote: str
    explanation: str
    confidence: float = Field(ge=0.0, le=1.0)
    argument_claim: str


class DetectionEvent(BaseModel):
    accepted: bool
    speaker: str
    text: str
    fallacy_detected: bool
    fallacy_type: str
    quote: str
    explanation: str
    confidence: float
    deduction: int
    new_score: int
    timestamp: float
    reason: str = ""
    argument_claim: str = ""


class StateSnapshot(BaseModel):
    scores: dict[str, int]
    events: list[DetectionEvent]
    current_context: dict[str, list[str]]
