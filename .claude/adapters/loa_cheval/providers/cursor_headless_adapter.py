"""Cursor-headless provider adapter — invokes `cursor-agent --print` for Cursor subscription auth.

Sibling to codex_headless_adapter / gemini_headless_adapter — same pattern,
different upstream CLI. Routes Loa's cheval calls through the Cursor Agent CLI
(`cursor-agent --print`) instead of a hosted HTTP API. Auth comes from the
operator's Cursor CLI login (`cursor-agent login`, stored under
`~/.cursor/cli-config.json`); no API key is consumed for these calls.

Cursor is its own expert-SWE corpus — a distinct cross-model review voice
alongside Claude (anthropic) and GPT/codex (openai). It fronts an OpenAI-class
model line (gpt-5.x, claude-*, gemini-* are all selectable via `--model`), but
the corpus + harness are Cursor's, so it earns a dedicated provider rather than
sitting under `openai`.

When to use:
  - Operator has a Cursor subscription and `cursor-agent` installed, and wants
    bridgebuilder / flatline-review / FAGAN-council to draw a third independent
    expert-SWE voice from Cursor's quota instead of API balance.

Design notes:
  - Single-shot only. Multi-turn message arrays flatten into one prompt with
    role-prefixed sections. Sufficient for the single-pass review modes
    (review / skeptic / scorer / dissenter) that are this adapter's consumers.
  - Tools / tool_choice are NOT forwarded to the cursor agent. The agent runs in
    read-only `ask` mode (Q&A / explanation, no edits, no shell), so it cannot
    touch the operator's files — pure inference, matching the gemini-headless
    `--approval-mode plan` / codex-headless `--sandbox read-only` posture.
  - `--trust` is passed because `--print` (headless) refuses to run in an
    untrusted workspace; without it the CLI emits a "Workspace Trust Required"
    prompt to stderr and exits before producing output. `ask` mode keeps the
    grant read-only (no code execution / file writes regardless of trust).
  - `--output-format json` produces a SINGLE JSON object (not a JSONL stream):
      {"type":"result","subtype":"success","is_error":false,"result":"<text>",
       "session_id":"...","request_id":"...",
       "usage":{"inputTokens":..,"outputTokens":..,"cacheReadTokens":..,
                "cacheWriteTokens":..}}
    so parsing mirrors gemini-headless (json.loads of the whole stdout), not
    codex-headless (line-by-line JSONL).
  - Token usage maps from cursor's usage shape:
      usage.inputTokens      → Usage.input_tokens
      usage.outputTokens     → Usage.output_tokens
      usage.cacheReadTokens  → metadata['cached_tokens']
    Cursor does not surface a separate reasoning-token field, so
    Usage.reasoning_tokens stays 0.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import time
from typing import Any, Dict, List, Optional

from loa_cheval.providers.base import (
    ProviderAdapter,
    build_headless_subprocess_env,
    enforce_context_window,
)
from loa_cheval.types import (
    CompletionRequest,
    CompletionResult,
    ConfigError,
    ProviderUnavailableError,
    RateLimitError,
    Usage,
)

logger = logging.getLogger("loa_cheval.providers.cursor_headless")

# cursor-agent CLI binary name (override via CURSOR_HEADLESS_BIN env var for testing)
_CURSOR_BIN_DEFAULT = "cursor-agent"

# Auth file populated by `cursor-agent login` (subscription mode)
_CURSOR_CONFIG_FILE = "~/.cursor/cli-config.json"

# Conservative defaults for subprocess wall-clock. ProviderConfig.read_timeout
# wins when set; these floors apply only when the loader hands defaults.
_CONNECT_TIMEOUT_FLOOR = 10.0
_READ_TIMEOUT_FLOOR = 600.0  # 10 min — agent sessions can be slow


class CursorHeadlessAdapter(ProviderAdapter):
    """Adapter that routes inference through `cursor-agent --print` (non-interactive).

    Provider config (no api_key field — CLI login is file-based):

        providers:
          cursor:
            type: cursor-headless
            connect_timeout: 10.0
            read_timeout: 600.0
            models:
              cursor-headless:
                kind: cli
                context_window: 200000
                extra:
                  cli_model: gpt-5.2

    Aliases bind to provider:model-id like other adapters:

        aliases:
          cursor-headless: cursor:cursor-headless
    """

    # Cycle-110 FR-2.3 — subscription-CLI dispatch; circuit-breaker writes
    # route to the (cursor, headless) bucket.
    auth_type: str = "headless"

    def complete(self, request: CompletionRequest) -> CompletionResult:
        """Invoke `cursor-agent --print` and return a normalized CompletionResult."""
        model_config = self._get_model_config(request.model)
        enforce_context_window(request, model_config)

        prompt = self._build_prompt(request.messages)
        cmd = self._build_command(request, model_config, prompt)
        timeout_s = self._compute_timeout()
        # Cycle-110 sprint-2b2b1 BB iter-2 F-001 closure: read per-model
        # headless_concurrency_limit (cycle-110 ModelConfig field). Default 50
        # when operator hasn't seeded a stress-test-discovered value (SDD §5.6).
        n_slots = getattr(model_config, "headless_concurrency_limit", None) or 50

        logger.debug(
            "cursor-headless invoking: model=%s timeout=%.0fs prompt_chars=%d slots=%d",
            request.model,
            timeout_s,
            len(prompt),
            n_slots,
        )

        # Cycle-110 sprint-2b2b1 T2.11 — N-slot semaphore wire-up.
        from loa_cheval.adapters.headless_concurrency import (
            SemaphoreExhausted as _SemaphoreExhausted,
            acquire_slot as _acquire_slot,
        )

        start = time.monotonic()
        try:
            with _acquire_slot("cursor-headless", n_slots=n_slots):
                try:
                    proc = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        timeout=timeout_s,
                        check=False,
                        # cursor-agent's `--print` flag consumes the prompt
                        # argument directly. Keep stdin closed so the CLI never
                        # blocks waiting for piped input in some shells.
                        stdin=subprocess.DEVNULL,
                        # Symmetric with codex / gemini (#879 / #880): strip
                        # API-key auth vars so the CLI uses its own login
                        # session, not an ambient API key.
                        env=build_headless_subprocess_env(),
                    )
                except subprocess.TimeoutExpired:
                    raise ProviderUnavailableError(
                        self.provider,
                        f"cursor-agent --print timed out after {timeout_s:.0f}s",
                    )
                except FileNotFoundError as exc:
                    raise ConfigError(
                        f"cursor-agent CLI not found on PATH (set CURSOR_HEADLESS_BIN "
                        f"to override). Install from https://cursor.com/cli. "
                        f"Original: {exc}"
                    ) from exc
        except _SemaphoreExhausted as exc:
            raise ProviderUnavailableError(
                self.provider,
                f"[CHAIN-EXHAUSTED-CONCURRENCY] cursor-headless semaphore "
                f"exhausted after {exc.waited_seconds:.1f}s "
                f"(n_slots={exc.n_slots})",
            ) from exc

        latency_ms = int((time.monotonic() - start) * 1000)

        # cursor-agent emits a single JSON object on success. Some failure
        # classes (workspace-trust, unknown model, auth) instead write a
        # plain-text diagnostic to stderr with EMPTY stdout (and exit 0), so
        # we try to parse stdout first and fall back to error classification
        # when there is no parseable JSON result.
        parsed: Optional[Dict[str, Any]] = None
        if proc.stdout and proc.stdout.strip():
            try:
                parsed = json.loads(proc.stdout)
            except json.JSONDecodeError:
                parsed = None

        if proc.returncode != 0 or (parsed and parsed.get("is_error")):
            self._raise_for_error(
                returncode=proc.returncode,
                stderr=proc.stderr or "",
                parsed=parsed,
            )

        if parsed is None:
            # Exit 0 but no JSON — the trust/model/auth diagnostics land here.
            self._raise_for_error(
                returncode=proc.returncode,
                stderr=proc.stderr or "",
                parsed=None,
            )

        return self._parse_json_output(
            parsed=parsed,
            requested_model=request.model,
            latency_ms=latency_ms,
        )

    def validate_config(self) -> List[str]:
        """Validate that the cursor-agent CLI is on PATH. Auth is best-effort surface."""
        errors: List[str] = []
        if self.config.type != "cursor-headless":
            errors.append(
                f"Provider '{self.provider}': type must be 'cursor-headless' "
                f"(got '{self.config.type}')"
            )

        bin_name = self._cursor_bin()
        if not shutil.which(bin_name):
            errors.append(
                f"Provider '{self.provider}': '{bin_name}' CLI not found on PATH. "
                f"Install from https://cursor.com/cli, then run: {bin_name} login"
            )

        # Best-effort auth probe: the CLI itself enforces auth at first call
        # (`cursor-agent login` writes ~/.cursor/cli-config.json), so we don't
        # duplicate the check here. Only structural config errors are returned.
        return errors

    def health_check(self) -> bool:
        """Verify the cursor-agent CLI is reachable. Does NOT make a model call."""
        bin_name = self._cursor_bin()
        if not shutil.which(bin_name):
            return False
        try:
            proc = subprocess.run(
                [bin_name, "--version"],
                capture_output=True,
                text=True,
                timeout=5.0,
                check=False,
            )
            return proc.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            return False

    # ---------------------------------------------------------------------
    # Internal: command construction
    # ---------------------------------------------------------------------

    def _cursor_bin(self) -> str:
        """Resolve the cursor-agent CLI binary name (env var override allowed)."""
        return os.environ.get("CURSOR_HEADLESS_BIN", _CURSOR_BIN_DEFAULT)

    def _build_command(
        self,
        request: CompletionRequest,
        model_config,
        prompt: str,
    ) -> List[str]:
        """Build the cursor-agent argv. Headless, read-only ask-mode, trusted."""
        # cycle-104 sprint-2 T2.11 amendment (mirrored): honor `extra.cli_model`
        # so a kind:cli alias (`cursor-headless`) translates to the real cursor
        # model id the CLI binary expects (the CLI doesn't recognize the Loa
        # alias). Operator-overridable to switch model lines per subscription.
        cli_model = (model_config.extra or {}).get("cli_model") or request.model
        cmd: List[str] = [
            self._cursor_bin(),
            "--print",                 # non-interactive: print response, no TUI
            "--output-format",
            "json",
            "--mode",
            "ask",                     # read-only Q&A; no edits, no shell exec
            "--trust",                 # required: --print refuses untrusted workspaces
            "--model",
            cli_model,
            prompt,                    # positional prompt (last arg)
        ]

        # Forward additional cursor-agent flags an operator may need but we
        # haven't promoted to first-class fields. Format: list of [flag, value?]
        # entries, mirroring gemini-headless's gemini_extra_flags escape hatch.
        extra = (model_config.extra or {})
        extra_flags = extra.get("cursor_extra_flags")
        if isinstance(extra_flags, list):
            # Insert before the positional prompt so flags stay flag-shaped.
            insert_at = len(cmd) - 1
            forwarded: List[str] = []
            for entry in extra_flags:
                if isinstance(entry, str):
                    forwarded.append(entry)
                elif isinstance(entry, list):
                    forwarded.extend(str(x) for x in entry)
            cmd[insert_at:insert_at] = forwarded

        return cmd

    def _compute_timeout(self) -> float:
        """Resolve the subprocess timeout. read_timeout wins when set."""
        connect = max(self.config.connect_timeout, _CONNECT_TIMEOUT_FLOOR)
        read = max(self.config.read_timeout, _READ_TIMEOUT_FLOOR)
        return connect + read

    # ---------------------------------------------------------------------
    # Internal: prompt flattening
    # ---------------------------------------------------------------------

    def _build_prompt(self, messages: List[Dict[str, Any]]) -> str:
        """Flatten message array into a single prompt for cursor-agent --print.

        Same shape as codex / gemini headless adapters — role-prefixed sections
        collapsed into one input string. Lossy compared to a native multi-turn
        API, but sufficient for single-shot review modes.
        """
        sections: List[str] = []
        for msg in messages:
            role = (msg.get("role") or "user").lower()
            content = msg.get("content", "")
            if isinstance(content, list):
                # Anthropic-style content blocks
                content = "\n".join(
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict)
                )
            elif not isinstance(content, str):
                try:
                    content = json.dumps(content)
                except (TypeError, ValueError):
                    content = str(content)

            label = {
                "system": "## System",
                "user": "## User",
                "assistant": "## Assistant",
                "tool": "## Tool result",
            }.get(role, f"## {role.capitalize()}")

            sections.append(f"{label}\n\n{content}".rstrip())

        return "\n\n".join(sections) + "\n"

    # ---------------------------------------------------------------------
    # Internal: JSON parsing
    # ---------------------------------------------------------------------

    def _parse_json_output(
        self,
        parsed: Dict[str, Any],
        requested_model: str,
        latency_ms: int,
    ) -> CompletionResult:
        """Parse a successful cursor-agent --output-format json single object.

        Shape (observed cursor-agent 2026.06.03):
          {
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "duration_ms": <int>,
            "duration_api_ms": <int>,
            "result": "<text>",
            "session_id": "...",
            "request_id": "...",
            "usage": {
              "inputTokens": <int>,
              "outputTokens": <int>,
              "cacheReadTokens": <int>,
              "cacheWriteTokens": <int>
            }
          }
        """
        session_id = parsed.get("session_id")
        content = (parsed.get("result") or "").strip("\n")

        usage_data = parsed.get("usage") or {}
        usage = Usage(
            input_tokens=int(usage_data.get("inputTokens") or 0),
            output_tokens=int(usage_data.get("outputTokens") or 0),
            # Cursor does not surface a separate reasoning-token field.
            reasoning_tokens=0,
            source="actual" if usage_data else "estimated",
        )

        metadata: Dict[str, Any] = {}
        cached = usage_data.get("cacheReadTokens")
        if cached:
            metadata["cached_tokens"] = int(cached)
        request_id = parsed.get("request_id")
        if request_id:
            metadata["request_id"] = request_id

        if not content:
            logger.warning(
                "cursor-headless: empty result field (model=%s, session=%s)",
                requested_model,
                session_id,
            )

        return CompletionResult(
            content=content,
            tool_calls=None,
            thinking=None,
            usage=usage,
            model=requested_model,
            latency_ms=latency_ms,
            provider=self.provider,
            interaction_id=session_id,
            metadata=metadata,
        )

    # ---------------------------------------------------------------------
    # Internal: error classification
    # ---------------------------------------------------------------------

    def _raise_for_error(
        self,
        returncode: int,
        stderr: str,
        parsed: Optional[Dict[str, Any]],
    ) -> None:
        """Map cursor failure (subprocess, stderr diagnostic, or is_error JSON) to typed cheval error."""
        # Prefer a structured JSON error message when present; otherwise the
        # plain-text stderr diagnostic (trust / model / auth all land here).
        if parsed and parsed.get("is_error"):
            full_diag = str(
                parsed.get("result")
                or parsed.get("error")
                or parsed.get("subtype")
                or "cursor-agent reported is_error"
            )
        else:
            full_diag = stderr.strip() or f"exit code {returncode}"

        diag_lower = full_diag.lower()

        # Workspace-trust gate — most common headless first-run failure. Most
        # actionable to surface explicitly even though the adapter already
        # passes --trust (operators overriding the command via cursor_extra_flags
        # could strip it).
        if "workspace trust" in diag_lower or "trust the contents" in diag_lower:
            raise ConfigError(
                f"cursor-agent refused an untrusted workspace. The adapter passes "
                f"--trust by default; if you overrode the command, restore it. "
                f"(diagnostic: {full_diag[:300]})"
            )

        # Rate-limit / quota
        if (
            "rate limit" in diag_lower
            or "429" in full_diag
            or "quota" in diag_lower
            or "too many requests" in diag_lower
            or "resource_exhausted" in diag_lower
        ):
            raise RateLimitError(self.provider)

        # Auth failure — `cursor-agent login` is the fix.
        if (
            "not logged in" in diag_lower
            or "log in" in diag_lower
            or "login" in diag_lower
            or "unauthorized" in diag_lower
            or "authentication" in diag_lower
            or "not authenticated" in diag_lower
        ):
            raise ConfigError(
                f"cursor-agent not authenticated. Run: cursor-agent login. "
                f"(Auth file: {_CURSOR_CONFIG_FILE}; diagnostic: {full_diag[:300]})"
            )

        snippet = full_diag[:500] or f"exit code {returncode}, no diagnostic"
        raise ProviderUnavailableError(
            self.provider,
            f"cursor-agent --print failed (exit {returncode}): {snippet}",
        )
