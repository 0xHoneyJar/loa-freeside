export class DependencyLedgerRejectedError extends Error {
  readonly reason: string;
  readonly remediation?: string;
  readonly safe_code: string;

  constructor(input: { reason: string; remediation?: string; safe_code?: string }) {
    super(input.reason);
    this.name = "DependencyLedgerRejectedError";
    this.reason = input.reason;
    this.remediation = input.remediation;
    this.safe_code = input.safe_code ?? input.reason;
  }
}

export class DependencyEdgeDecodeError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "DependencyEdgeDecodeError";
    this.detail = detail;
  }
}
