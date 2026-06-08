"""cycle-113 Sprint 1 T1.1 — typed abort exception for streaming-recovery.

Per cycle-113 SDD §2.2: this module is the home for the typed exception
class raised when `StreamingRecoveryTracker.{check_deadline,on_token}`
returns `decision.abort == True`. The library itself (`recovery.py`) is
frozen for cycle-113 — see operator-approval.md C113.OP-AUTH-1 — so the
exception lives in a separate module instead.

The exception flows through each provider adapter's existing
``try / except`` arm and is translated to ``ProviderUnavailableError``
(retryable=True) so the cycle-099 chain-walk mechanism takes over. All
three abort reasons route the same way because KF-002's goal is
"walk to the next model in the chain when the current one degrades":

  * ``first_token_deadline``       -> ProviderUnavailableError  (chain-walks)
  * ``empty_content_window``       -> ProviderUnavailableError  (chain-walks; KF-002 class)
  * ``cot_budget_exhausted``       -> ProviderUnavailableError  (chain-walks)

(SDD §3.5 prose originally split the mapping with empty-content + CoT
routing via InvalidInputError. Cycle-113 sprint-168 T1.7 deviation
applies the chain-walk-consistent mapping per cycle-099 retryable-error
contract; SDD §3.5 corrigendum tracked alongside the §5.4 corrigendum
in sprint-169.)

The exception carries the full decision context plus the partial-content
snapshot the parser had accumulated at the time of the abort, so the
adapter wrapper can emit a populated ``streaming_recovery`` MODELINV
envelope field (cycle-113 SDD §4.2).
"""

from __future__ import annotations

from typing import Optional


class StreamingRecoveryAbort(Exception):
    """Raised by a streaming parser when StreamingRecoveryTracker returns
    decision.abort == True.

    The adapter wrapper translates this to a retryable
    ``ProviderUnavailableError`` for ALL three abort reasons so the
    cycle-099 within-company chain-walks (KF-002 chain-walk contract).
    See the module docstring for the per-reason mapping rationale.

    The adapter ALSO reconstructs the MODELINV envelope's
    ``streaming_recovery`` field from ``self.{reason,
    tokens_before_abort, config_applied}`` before re-raising.
    """

    def __init__(
        self,
        reason: str,
        tokens_before_abort: int,
        config_applied: dict,
        partial_content: Optional[str] = None,
    ) -> None:
        super().__init__(
            f"streaming aborted by recovery tracker: "
            f"reason={reason} tokens={tokens_before_abort}"
        )
        self.reason = reason
        """One of ``first_token_deadline`` / ``empty_content_window`` /
        ``cot_budget_exhausted`` — matches ``StreamingRecoveryDecision.reason``."""

        self.tokens_before_abort = tokens_before_abort
        """Number of tokens the tracker had observed before deciding to
        abort. Zero for ``first_token_deadline`` (no tokens arrived);
        equal to ``empty_content_window_tokens`` for that reason; equal
        to current ``tokens_seen`` for ``cot_budget_exhausted``."""

        self.config_applied = config_applied
        """Serialized form of the ``StreamingRecoveryConfig`` that was in
        effect when the abort fired. Adapter copies this verbatim into
        the MODELINV envelope's ``streaming_recovery.config_applied`` so
        operators can audit threshold-config drift over time (I-3)."""

        self.partial_content = partial_content
        """The accumulated visible content the parser had built up
        before the abort fired. May be ``None`` (no tokens arrived) or
        the empty string (all tokens were CoT/empty). NOT used by the
        adapter's MODELINV emit — preserved for diagnostic surfacing in
        the structured WARNING log (NFR-Obs-1)."""


__all__ = ["StreamingRecoveryAbort"]
