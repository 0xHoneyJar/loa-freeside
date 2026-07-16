import { execFileSync } from "node:child_process";

const COMMIT_RE = /^[0-9a-f]{40}$/;

export class SourceCommitError extends Error {
  readonly _tag = "SourceCommitError";
  constructor(message: string) {
    super(message);
    this.name = "SourceCommitError";
  }
}

const runGit = (cwd: string, args: ReadonlyArray<string>): string => {
  try {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr =
      error !== null &&
      typeof error === "object" &&
      "stderr" in error &&
      typeof (error as { stderr: unknown }).stderr === "string"
        ? (error as { stderr: string }).stderr.trim()
        : String(error);
    throw new SourceCommitError(`git ${args.join(" ")} failed: ${stderr}`);
  }
};

export const isDirtySourceTree = (repositoryRoot: string): boolean => {
  const porcelain = runGit(repositoryRoot, ["status", "--porcelain"]);
  return porcelain.length > 0;
};

/**
 * Resolve and validate a source commit against repository truth.
 *
 * - Must be a full 40-char lowercase hex SHA (or resolvable to one).
 * - Must name an actual commit object reachable from HEAD.
 * - Zero / nonexistent / arbitrary SHAs are rejected at pack time.
 * - Dirty trees are allowed only because the pack also binds
 *   `source_tree_sha256` of the exact packed inventory (see identity/manifest).
 */
export const assertReachableSourceCommit = (
  repositoryRoot: string,
  requested: string,
): string => {
  const trimmed = requested.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new SourceCommitError("source_commit is required");
  }
  if (trimmed === "0".repeat(40)) {
    throw new SourceCommitError("source_commit must not be the zero object");
  }

  let resolved: string;
  try {
    resolved = runGit(repositoryRoot, ["rev-parse", "--verify", `${trimmed}^{commit}`]);
  } catch {
    throw new SourceCommitError(
      `source_commit is not a reachable git commit: ${trimmed}`,
    );
  }
  if (!COMMIT_RE.test(resolved)) {
    throw new SourceCommitError(`source_commit did not resolve to sha40: ${resolved}`);
  }

  try {
    runGit(repositoryRoot, ["merge-base", "--is-ancestor", resolved, "HEAD"]);
  } catch {
    throw new SourceCommitError(
      `source_commit ${resolved} is not an ancestor of HEAD (unreachable from current repository)`,
    );
  }

  return resolved;
};

export const resolveHeadCommit = (repositoryRoot: string): string => {
  const head = runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  if (!COMMIT_RE.test(head)) {
    throw new SourceCommitError(`HEAD did not resolve to sha40: ${head}`);
  }
  return head;
};

/**
 * Locate the git repository root for a package path (worktree-safe).
 */
export const resolveRepositoryRoot = (packageRoot: string): string =>
  runGit(packageRoot, ["rev-parse", "--show-toplevel"]);
