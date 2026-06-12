/// <reference types="node" />
import { Buffer } from "node:buffer";

export const ASSON_VERSION: string;

export function jcs(v: any): string;
export function sha256(b: Buffer | string): string;
export function hashObj(o: any): string;
export function hashOutput(stdout: string, ioOutput: string): string;

export function treeHash(
  dir: string,
  opts?: { ignore?: string[] }
): string;

export function createSigner(opts?: {
  signerId?: string;
  keyVersion?: number;
  signatureType?: string;
}): {
  signerId: string;
  keyVersion: number;
  signatureType: string;
  key_id: string;
  publicKey: string;
  _privateKey: string;
};

export function attestBuild(
  veve: any,
  cliDir: string,
  signer: any,
  opts?: { gitCommit?: string }
): any;

export function verifyAttestation(
  veve: any,
  cliDir: string,
  publicKey: any
): { ok: boolean; reason?: string; checks?: any };

export function invoke(
  veve: any,
  cliDir: string,
  argv?: string[],
  stdin?: string | null
): {
  stdout: string;
  exit: number;
  output_hash: string;
  error?: string;
};

export function runVectors(
  veve: any,
  cliDir: string
): Array<{
  name: string;
  pass: boolean;
  expected: string;
  got: string;
  exit: number;
}>;

export function harvestVector(
  veve: any,
  cliDir: string,
  opts: { name: string; argv?: string[]; stdin?: string | null }
): {
  name: string;
  argv: string[];
  stdin: string | null;
  expect_output_hash: string;
  expect_exit: number;
};

export function toCommandPolicy(
  veve: any,
  cliDir: string
): any;

export interface DoctorReport {
  name: string;
  claimed: number;
  earned: number;
  attestation_tier: string;
  vectors: Array<{
    name: string;
    pass: boolean;
    expected: string;
    got: string;
    exit: number;
  }>;
  findings: Array<{
    severity: "fail" | "warn";
    as_id: string;
    message: string;
  }>;
  exit: number;
}

export function doctor(
  veve: any,
  cliDir: string,
  opts?: { publicKey?: string | null }
): DoctorReport;
