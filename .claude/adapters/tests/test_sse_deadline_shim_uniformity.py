"""cycle-113 Sprint 2 T2.9 — AST-uniformity for the deadline-shim copies (R-SDD-1).

SDD §3.1 ships three distinct shim copies (one per parser shape) because the
library is frozen for cycle-113 and refactoring to a shared helper would
risk Sprint-4A fail-closed invariants. The three copies are:

  1. anthropic_streaming._iter_sse_events_with_deadline       (Anthropic SSE)
  2. openai_streaming._iter_chat_stream_chunks_with_deadline  (Chat-completions)
  3. openai_streaming._iter_sse_events_raw_data_with_deadline (Responses + Google)

R-SDD-1 mitigation: an AST-uniformity test pins behavior parity across the
three copies. A future engineer fixing a bug in one copy must update the
others or this test fails.

The test extracts the AST of each shim, normalizes provider-specific
identifiers (function names, underlying iterator names), and compares
structural equivalence.
"""

from __future__ import annotations

import ast
import inspect
import sys
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


SHIM_REGISTRY = (
    ("anthropic_streaming", "_iter_sse_events_with_deadline"),
    ("openai_streaming", "_iter_chat_stream_chunks_with_deadline"),
    ("openai_streaming", "_iter_sse_events_raw_data_with_deadline"),
)


# Per-shim provider-specific identifier substitutions. The AST comparison
# normalizes these to a canonical token so the structural shapes are
# directly comparable.
NORMALIZATION_MAP = {
    "_iter_sse_events_with_deadline": "__SHIM__",
    "_iter_chat_stream_chunks_with_deadline": "__SHIM__",
    "_iter_sse_events_raw_data_with_deadline": "__SHIM__",
    "_iter_sse_events": "__UNDERLYING__",
    "_iter_chat_stream_chunks": "__UNDERLYING__",
    "_iter_sse_events_raw_data": "__UNDERLYING__",
}


def _get_shim_source(module_name: str, func_name: str) -> str:
    """Import module + extract function source."""
    full_name = f"loa_cheval.providers.{module_name}"
    module = __import__(full_name, fromlist=[func_name])
    func = getattr(module, func_name)
    return inspect.getsource(func)


def _normalize_ast(src: str) -> str:
    """Parse + serialize an AST after normalizing provider-specific names.

    Uses ``ast.dump`` for structural comparison, since:
      * It ignores formatting / whitespace / comments
      * It captures every node type, attribute, and constant
      * Normalized provider-specific names become equal across copies
    """
    tree = ast.parse(src)

    class NameNormalizer(ast.NodeTransformer):
        def visit_Name(self, node: ast.Name) -> ast.AST:
            if node.id in NORMALIZATION_MAP:
                node.id = NORMALIZATION_MAP[node.id]
            return node

        def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.AST:
            if node.name in NORMALIZATION_MAP:
                node.name = NORMALIZATION_MAP[node.name]
            # Strip the return annotation — Chat shim returns
            # Iterator[Optional[str]] (matches _iter_chat_stream_chunks's
            # yield shape), while Anthropic + Responses shims return
            # Iterator[tuple] (event-name + payload). The yield-shape
            # divergence is legitimate per-shim variance and not part of
            # the behavioral contract R-SDD-1 pins.
            node.returns = None
            # Strip the docstring node so divergence in comments/docstrings
            # doesn't break parity. The function's behavioral contract is
            # carried by the executable AST.
            if (
                node.body
                and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
                and isinstance(node.body[0].value.value, str)
            ):
                node.body = node.body[1:]
            self.generic_visit(node)
            return node

    tree = NameNormalizer().visit(tree)
    ast.fix_missing_locations(tree)
    return ast.dump(tree)


def _collect_normalized_sources() -> List[tuple]:
    """Returns [(module, func_name, normalized_ast_dump), ...]."""
    out = []
    for module, name in SHIM_REGISTRY:
        src = _get_shim_source(module, name)
        normalized = _normalize_ast(src)
        out.append((module, name, normalized))
    return out


def test_three_shim_copies_share_identical_normalized_ast():
    """R-SDD-1: all 3 shim copies MUST be structurally identical modulo
    provider-specific identifier names (parser function name +
    underlying iterator name)."""
    items = _collect_normalized_sources()
    sample_module, sample_name, sample_ast = items[0]

    for module, name, normalized in items[1:]:
        assert normalized == sample_ast, (
            f"deadline-shim AST divergence:\n"
            f"  sample: {sample_module}.{sample_name}\n"
            f"  other:  {module}.{name}\n"
            f"  sample dump (first 500 chars): {sample_ast[:500]}\n"
            f"  other dump (first 500 chars):  {normalized[:500]}\n\n"
            f"R-SDD-1: if you intentionally diverged the shim copies, "
            f"update SHIM_REGISTRY in this test OR amend the SDD §3.1 "
            f"R-SDD-1 mitigation to acknowledge the divergence."
        )


def test_all_three_shims_raise_streaming_recovery_abort_on_deadline():
    """Smoke: each shim, given a tracker whose check_deadline returns
    decision.abort=True, MUST raise StreamingRecoveryAbort with
    reason from the decision (not silently swallow)."""
    from dataclasses import dataclass

    from loa_cheval.streaming import StreamingRecoveryAbort
    from loa_cheval.providers.anthropic_streaming import _iter_sse_events_with_deadline
    from loa_cheval.providers.openai_streaming import (
        _iter_chat_stream_chunks_with_deadline,
        _iter_sse_events_raw_data_with_deadline,
    )

    shims = [
        _iter_sse_events_with_deadline,
        _iter_chat_stream_chunks_with_deadline,
        _iter_sse_events_raw_data_with_deadline,
    ]

    @dataclass
    class AbortDecision:
        abort: bool = True
        reason: str = "first_token_deadline"
        tokens_before_abort: int = 0

    class AlwaysAbortTracker:
        def check_deadline(self, now_s):
            return AbortDecision()

    import pytest

    for shim in shims:
        gen = shim(
            iter([b""]),
            AlwaysAbortTracker(),
            {"first_token_deadline_s": 30.0},
            lambda: 100.0,
        )
        with pytest.raises(StreamingRecoveryAbort) as info:
            next(gen)
        assert info.value.reason == "first_token_deadline"
        assert info.value.tokens_before_abort == 0
