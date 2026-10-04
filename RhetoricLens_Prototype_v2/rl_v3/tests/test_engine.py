from app.engine import RhetoricEngine
from app.providers import MockProvider


def test_ad_hominem_penalty_and_quote():
    engine = RhetoricEngine(MockProvider())
    event = engine.analyze(
        "Speaker A",
        "You don't understand economics, so your argument is meaningless.",
        timestamp=100.0,
    )
    assert event.accepted is True
    assert event.fallacy_type == "Ad Hominem"
    assert event.deduction == 8
    assert event.new_score == 92
    assert 3 <= len(event.quote.split()) <= 8


def test_rude_but_not_patterned_sentence_gets_no_flag():
    engine = RhetoricEngine(MockProvider())
    event = engine.analyze(
        "Speaker A",
        "That is a ridiculous proposal, but the budget estimate is still the part we should examine.",
        timestamp=100.0,
    )
    assert event.accepted is False
    assert event.new_score == 100


def test_quote_validation_is_server_side():
    from app.models import FallacyType, ModelVerdict

    class BadQuoteProvider(MockProvider):
        def classify(self, text: str, context: str) -> ModelVerdict:
            return ModelVerdict(
                fallacy_detected=True,
                fallacy_type=FallacyType.AD_HOMINEM,
                quote="invented words here",
                explanation="Attacks the person instead of the argument.",
                confidence=0.99,
                argument_claim=text,
            )

    engine = RhetoricEngine(BadQuoteProvider())
    event = engine.analyze("Speaker A", "The budget is wrong because data is missing.", timestamp=100.0)
    assert event.accepted is False
    assert event.deduction == 0
    assert event.new_score == 100
    assert event.reason == "Quote does not match transcript"


def test_duplicate_flags_are_suppressed():
    engine = RhetoricEngine(MockProvider())
    text = "You're not qualified to talk about this, so your point can be ignored."
    first = engine.analyze("Speaker A", text, timestamp=100.0)
    second = engine.analyze("Speaker A", text, timestamp=104.0)
    assert first.accepted is True
    assert second.accepted is False
    assert second.reason == "Duplicate flag suppressed"
    assert second.new_score == 92
