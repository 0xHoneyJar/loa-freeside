"""cycle-113 Sprint 2 T2.7 — OpenAI recovery-integration tests (FR-B-5).

Mirrors test_anthropic_integration.py for OpenAI Chat + Responses parsers.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "cycle-113" / "streaming-parity"


def _load(name: str, provider_slug: str) -> bytes:
    return (FIXTURES_DIR / f"{name}.{provider_slug}.sse").read_bytes()


def _byte_iter(data: bytes):
    return iter([data])


class _FakeClock:
    def __init__(self, step_s: float = 100.0) -> None:
        self._t = 0.0
        self._step = step_s

    def __call__(self) -> float:
        self._t += self._step
        return self._t


class _PinnedClock:
    def __init__(self, t: float = 0.0) -> None:
        self._t = t

    def __call__(self) -> float:
        return self._t


# ---------------------------------------------------------------------------
# OpenAI Chat — healthy + abort paths
# ---------------------------------------------------------------------------


def test_chat_healthy_attaches_telemetry():
    from loa_cheval.providers.openai_streaming import parse_openai_chat_stream

    r = parse_openai_chat_stream(
        _byte_iter(_load("healthy-short", "openai-chat")),
        model_data={},
        reasoning_class=False,
        now_provider=_PinnedClock(0.0),
    )
    sr = r.metadata["streaming_recovery"]
    assert sr["triggered"] is False
    assert r.content, "healthy fixture must produce non-empty content"


def test_chat_aborts_on_empty_content_window():
    from loa_cheval.providers.openai_streaming import parse_openai_chat_stream
    from loa_cheval.streaming import StreamingRecoveryAbort

    with pytest.raises(StreamingRecoveryAbort) as info:
        parse_openai_chat_stream(
            _byte_iter(_load("abort-empty-content-window", "openai-chat")),
            model_data={},
            reasoning_class=False,
            now_provider=_PinnedClock(0.0),
        )
    assert info.value.reason == "empty_content_window"
    assert info.value.tokens_before_abort == 200


def test_chat_aborts_on_first_token_deadline():
    from loa_cheval.providers.openai_streaming import parse_openai_chat_stream
    from loa_cheval.streaming import StreamingRecoveryAbort

    with pytest.raises(StreamingRecoveryAbort) as info:
        parse_openai_chat_stream(
            _byte_iter(_load("abort-first-token-deadline", "openai-chat")),
            model_data={},
            reasoning_class=False,
            now_provider=_FakeClock(step_s=100.0),
        )
    assert info.value.reason == "first_token_deadline"
    assert info.value.tokens_before_abort == 0


def test_chat_aborts_on_cot_budget_when_reasoning_class():
    from loa_cheval.providers.openai_streaming import parse_openai_chat_stream
    from loa_cheval.streaming import StreamingRecoveryAbort

    with pytest.raises(StreamingRecoveryAbort) as info:
        parse_openai_chat_stream(
            _byte_iter(_load("abort-cot-budget-exhausted", "openai-chat")),
            model_data={},
            reasoning_class=True,
            now_provider=_PinnedClock(0.0),
        )
    assert info.value.reason == "cot_budget_exhausted"


def test_chat_cot_budget_does_not_fire_when_non_reasoning():
    from loa_cheval.providers.openai_streaming import parse_openai_chat_stream

    r = parse_openai_chat_stream(
        _byte_iter(_load("abort-cot-budget-non-reasoning", "openai-chat")),
        model_data={},
        reasoning_class=False,
        now_provider=_PinnedClock(0.0),
    )
    assert r.metadata["streaming_recovery"]["triggered"] is False


def test_chat_kwargs_default_safe():
    from loa_cheval.providers.openai_streaming import parse_openai_chat_stream

    r = parse_openai_chat_stream(_byte_iter(_load("healthy-short", "openai-chat")))
    sr = r.metadata.get("streaming_recovery")
    assert sr is not None
    assert sr["triggered"] is False


# ---------------------------------------------------------------------------
# OpenAI Responses — healthy + abort paths
# ---------------------------------------------------------------------------


def test_responses_healthy_attaches_telemetry():
    from loa_cheval.providers.openai_streaming import parse_openai_responses_stream

    r = parse_openai_responses_stream(
        _byte_iter(_load("healthy-short", "openai-responses")),
        model_data={},
        reasoning_class=False,
        now_provider=_PinnedClock(0.0),
    )
    sr = r.metadata["streaming_recovery"]
    assert sr["triggered"] is False
    assert r.content, "healthy fixture must produce non-empty content"


def test_responses_aborts_on_empty_content_window():
    from loa_cheval.providers.openai_streaming import parse_openai_responses_stream
    from loa_cheval.streaming import StreamingRecoveryAbort

    with pytest.raises(StreamingRecoveryAbort) as info:
        parse_openai_responses_stream(
            _byte_iter(_load("abort-empty-content-window", "openai-responses")),
            model_data={},
            reasoning_class=False,
            now_provider=_PinnedClock(0.0),
        )
    assert info.value.reason == "empty_content_window"


def test_responses_aborts_on_first_token_deadline():
    from loa_cheval.providers.openai_streaming import parse_openai_responses_stream
    from loa_cheval.streaming import StreamingRecoveryAbort

    with pytest.raises(StreamingRecoveryAbort) as info:
        parse_openai_responses_stream(
            _byte_iter(_load("abort-first-token-deadline", "openai-responses")),
            model_data={},
            reasoning_class=False,
            now_provider=_FakeClock(step_s=100.0),
        )
    assert info.value.reason == "first_token_deadline"


def test_responses_aborts_on_cot_budget_when_reasoning_class():
    from loa_cheval.providers.openai_streaming import parse_openai_responses_stream
    from loa_cheval.streaming import StreamingRecoveryAbort

    with pytest.raises(StreamingRecoveryAbort) as info:
        parse_openai_responses_stream(
            _byte_iter(_load("abort-cot-budget-exhausted", "openai-responses")),
            model_data={},
            reasoning_class=True,
            now_provider=_PinnedClock(0.0),
        )
    assert info.value.reason == "cot_budget_exhausted"


def test_responses_cot_budget_does_not_fire_when_non_reasoning():
    from loa_cheval.providers.openai_streaming import parse_openai_responses_stream

    r = parse_openai_responses_stream(
        _byte_iter(_load("abort-cot-budget-non-reasoning", "openai-responses")),
        model_data={},
        reasoning_class=False,
        now_provider=_PinnedClock(0.0),
    )
    assert r.metadata["streaming_recovery"]["triggered"] is False


def test_responses_kwargs_default_safe():
    from loa_cheval.providers.openai_streaming import parse_openai_responses_stream

    r = parse_openai_responses_stream(_byte_iter(_load("healthy-short", "openai-responses")))
    sr = r.metadata.get("streaming_recovery")
    assert sr is not None
    assert sr["triggered"] is False


# ---------------------------------------------------------------------------
# Adapter source pins (translation arm ordering)
# ---------------------------------------------------------------------------


def test_openai_adapter_orders_streaming_recovery_abort_arm_first():
    import inspect
    from loa_cheval.providers import openai_adapter

    src = inspect.getsource(openai_adapter)
    assert "StreamingRecoveryAbort" in src
    assert "except StreamingRecoveryAbort" in src
    abort_idx = src.index("except StreamingRecoveryAbort")
    stream_idx = src.index("except ProviderStreamError")
    value_idx = src.index("except ValueError as parse_err")
    assert abort_idx < stream_idx < value_idx
