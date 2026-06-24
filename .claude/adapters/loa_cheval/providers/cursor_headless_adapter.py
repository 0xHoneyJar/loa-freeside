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
import re
import shutil
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional

from loa_cheval.providers.base import (
    ProviderAdapter,
    SubprocessOutputCapExceeded,
    build_headless_subprocess_env,
    enforce_context_window,
    run_subprocess_pgkill,
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
        cmd = self._build_command(request, model_config)
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

        # #966 round-4 (HIGH_CONSENSUS) + #982: run cursor-agent in a FRESH empty
        # workspace (defense-in-depth — `ask` mode is read-only, but an isolated
        # cwd mirrors codex's `-C <workspace>` untrusted-prompt posture) and
        # dispatch through the process-group-killing helper so a timeout reaps the
        # WHOLE cursor-agent tree instead of orphaning it (the #982 fix codex got
        # but this adapter missed). The prompt rides STDIN (input=prompt), never
        # argv — cursor-agent reads stdin (verified), so a 200K-token prompt can't
        # blow ARG_MAX or leak into the process command line.
        workspace: Optional[str] = None
        start = time.monotonic()
        try:
            try:
                workspace = tempfile.mkdtemp(prefix="loa-cursor-ws-")
            except OSError as exc:
                raise ConfigError(
                    f"cursor-headless: failed to create isolated workspace: {exc}"
                ) from exc
            with _acquire_slot("cursor-headless", n_slots=n_slots):
                try:
                    proc = run_subprocess_pgkill(
                        cmd,
                        input=prompt,
                        timeout=timeout_s,
                        # Symmetric with codex / gemini (#879 / #880): strip
                        # API-key auth vars so the CLI uses its own login
                        # session, not an ambient API key.
                        env=build_headless_subprocess_env(),
                        cwd=workspace,
                    )
                except subprocess.TimeoutExpired:
                    raise ProviderUnavailableError(
                        self.provider,
                        f"cursor-agent --print timed out after {timeout_s:.0f}s",
                    )
                except SubprocessOutputCapExceeded as exc:
                    # Truncated output must never masquerade as success — the cap
                    # is a provider failure so the chain advances (codex parity).
                    raise ProviderUnavailableError(
                        self.provider, f"cursor-agent {exc}",
                    ) from exc
                except FileNotFoundError as exc:
                    raise ConfigError(
                        f"cursor-agent CLI not found on PATH (set CURSOR_HEADLESS_BIN "
                        f"to override). Install from https://cursor.com/cli. "
                        f"Original: {exc}"
                    ) from exc
                except OSError as exc:
                    # A spawn-level OSError (permission, exec-format, ENOMEM) is a
                    # provider availability problem, not a config error — let the
                    # chain advance. FileNotFoundError (a missing binary, an
                    # OSError subclass) is handled above as ConfigError.
                    raise ProviderUnavailableError(
                        self.provider, f"cursor-agent failed to spawn: {exc}",
                    ) from exc
        except _SemaphoreExhausted as exc:
            raise ProviderUnavailableError(
                self.provider,
                f"[CHAIN-EXHAUSTED-CONCURRENCY] cursor-headless semaphore "
                f"exhausted after {exc.waited_seconds:.1f}s "
                f"(n_slots={exc.n_slots})",
            ) from exc
        finally:
            if workspace is not None:
                shutil.rmtree(workspace, ignore_errors=True)

        latency_ms = int((time.monotonic() - start) * 1000)

        # cursor-agent emits a single JSON object on success. Some failure
        # classes (workspace-trust, unknown model, auth) instead write a
        # plain-text diagnostic to stderr with EMPTY stdout (and exit 0), so
        # we try to parse stdout first and fall back to error classification
        # when there is no parseable JSON result.
        parsed: Optional[Dict[str, Any]] = None
        if proc.stdout and proc.stdout.strip():
            # cursor-agent emits a SINGLE {"type":"result",...} envelope, but may
            # PREPEND non-result log lines (e.g. {"level":"warn",...} or a node
            # ExperimentalWarning). Scan for the RESULT line so a log line cannot
            # shadow it; a stdout carrying ONLY log lines (no result) leaves
            # parsed=None and is treated as a failure, never an empty success.
            for line in proc.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and obj.get("type") == "result":
                    parsed = obj
                    break

        if proc.returncode != 0 or (parsed and parsed.get("is_error")):
            self._raise_for_error(
                returncode=proc.returncode,
                stderr=proc.stderr or "",
                parsed=parsed,
                stdout=proc.stdout or "",
            )

        if parsed is None:
            # Exit 0 but no result envelope — trust/model/auth diagnostics AND
            # transport errors cursor writes to stdout (resource_exhausted) land
            # here; the raw stdout is the diagnostic.
            self._raise_for_error(
                returncode=proc.returncode,
                stderr=proc.stderr or "",
                parsed=None,
                stdout=proc.stdout or "",
            )

        # Transport-probe safety (the silencing-attack regression): a rate-limit
        # / transport error on STDERR means the call was THROTTLED even if cursor
        # still emitted a result envelope — back the chain off rather than accept
        # a partial result. The result's own usage/metadata is NOT scanned (a
        # token count like 4290 must never masquerade as a 429); only a standalone
        # 429 status / explicit rate-limit phrasing on stderr counts.
        stderr_l = (proc.stderr or "").lower()
        if (
            re.search(r"\b429\b", proc.stderr or "")
            or "rate limit" in stderr_l
            or "resource_exhausted" in stderr_l
            or "too many requests" in stderr_l
        ):
            raise RateLimitError(self.provider)

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
    ) -> List[str]:
        """Build the cursor-agent argv (flags only — the prompt rides STDIN, not
        argv, so a 200K-token prompt can't blow ARG_MAX or leak into the process
        command line). Headless, read-only ask-mode, trusted."""
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
            "plan",                    # read-only/planning: analyze + propose, no edits
            "--sandbox",
            "enabled",                 # sandboxed even under --trust (defense-in-depth,
                                       # matching gemini --approval-mode plan / codex
                                       # --sandbox read-only). Verified: the full flag
                                       # set dispatches over stdin (2026-06-24).
            "--trust",                 # required: --print refuses untrusted workspaces
            "--model",
            cli_model,
            # No positional prompt: cursor-agent reads it from STDIN (complete()
            # passes input=prompt to run_subprocess_pgkill).
        ]

        # Forward additional cursor-agent flags an operator may need but we
        # haven't promoted to first-class fields. Format: list of [flag, value?]
        # entries, mirroring gemini-headless's gemini_extra_flags escape hatch.
        extra = (model_config.extra or {})
        extra_flags = extra.get("cursor_extra_flags")
        if isinstance(extra_flags, list):
            # Append the forwarded flags — there is no positional prompt to keep
            # them ahead of (the prompt rides STDIN now).
            for entry in extra_flags:
                if isinstance(entry, str):
                    cmd.append(entry)
                elif isinstance(entry, list):
                    cmd.extend(str(x) for x in entry)

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

        # Coerce usage fields defensively: cursor may emit a non-int (a string
        # like "oops", or null) on a malformed/partial envelope — int() would
        # crash, turning a recoverable parse into a hard failure.
        def _int0(v: Any) -> int:
            try:
                return int(v)
            except (TypeError, ValueError):
                return 0

        usage_data = parsed.get("usage") or {}
        usage = Usage(
            input_tokens=_int0(usage_data.get("inputTokens")),
            output_tokens=_int0(usage_data.get("outputTokens")),
            # Cursor does not surface a separate reasoning-token field.
            reasoning_tokens=0,
            source="actual" if usage_data else "estimated",
        )

        metadata: Dict[str, Any] = {}
        cached = _int0(usage_data.get("cacheReadTokens"))
        if cached:
            metadata["cached_tokens"] = cached
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
            model=parsed.get("model") or requested_model,
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
        stdout: str = "",
    ) -> None:
        """Map cursor failure (subprocess, stderr diagnostic, or is_error JSON) to typed cheval error."""
        # Prefer a structured JSON error message when present; otherwise the
        # plain-text diagnostic. cursor-agent surfaces transport errors
        # (ConnectError / [resource_exhausted]) on STDOUT with a ZERO exit code
        # and a non-JSON body, so the diagnostic must include stdout — checking
        # stderr alone misses them and mis-classifies a rate-limit as a generic
        # failure (the chain then can't react correctly).
        if parsed and parsed.get("is_error"):
            full_diag = str(
                parsed.get("result")
                or parsed.get("error")
                or parsed.get("subtype")
                or "cursor-agent reported is_error"
            )
        else:
            full_diag = (
                (stderr.strip() + " " + stdout.strip()).strip()
                or f"exit code {returncode}"
            )

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

        # Rate-limit / quota. Match 429 as a STANDALONE token (HTTP status), not
        # a substring — "429ms" (a latency) and "4290" (a token count) must not
        # masquerade as a rate limit (the transport-probe-safety regression).
        if (
            "rate limit" in diag_lower
            or re.search(r"\b429\b", full_diag)
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

        # Final fallback — nothing specific matched, but this is STILL a failure;
        # the chain must advance, never a silent pass. Name the shape so the
        # cause is legible (and so transport-probe-safety regressions stay
        # distinguishable): an is_error envelope vs. no parseable result at all.
        snippet = full_diag[:500] or f"exit code {returncode}, no diagnostic"
        if parsed is not None and parsed.get("is_error"):
            raise ProviderUnavailableError(
                self.provider,
                f"cursor-agent reported is_error (exit {returncode}): {snippet}",
            )
        if parsed is None:
            raise ProviderUnavailableError(
                self.provider,
                f"cursor-agent produced no parseable JSON result "
                f"(exit {returncode}): {snippet}",
            )
        raise ProviderUnavailableError(
            self.provider,
            f"cursor-agent --print failed (exit {returncode}): {snippet}",
        )
