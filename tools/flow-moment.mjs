#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { escapeMarkdownText, markdownBulletList } from "./markdown-text.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLOW_SCHEMA_PATH = path.join(ROOT, "spec/product/flow-moment.schema.json");
const HIVEMIND_SCHEMA_PATH = path.join(ROOT, "tools/hivemind/hivemind-labels.v1.0.json");
const DEFAULT_RECORDS_PATH = path.join(ROOT, "product/flow-moments");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const hivemindSchema = readJson(HIVEMIND_SCHEMA_PATH);
  ajv.addSchema(hivemindSchema, hivemindSchema.$id);
  return ajv.compile(readJson(FLOW_SCHEMA_PATH));
}

const schemaValidator = createSchemaValidator();

function formatSchemaError(error) {
  const location = error.instancePath || "/";
  return `schema ${location}: ${error.message}`;
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))];
}

function evidenceKindsCovered(document) {
  const signals = new Map(document.evidence_contract.signals.map((signal) => [signal.id, signal]));
  const covered = new Set();
  for (const observation of document.evidence_contract.observations) {
    for (const signalId of observation.signal_ids) {
      const signal = signals.get(signalId);
      if (signal) covered.add(signal.kind);
    }
  }
  return covered;
}

function semanticErrors(document, today) {
  const errors = [];
  const signals = document.evidence_contract.signals;
  const observations = document.evidence_contract.observations;
  const signalIds = new Set(signals.map((signal) => signal.id));

  const duplicateSignals = duplicates(signals.map((signal) => signal.id));
  if (duplicateSignals.length > 0) {
    errors.push(`evidence_contract.signals: duplicate ids: ${duplicateSignals.join(", ")}`);
  }

  const signalKinds = new Set(signals.map((signal) => signal.kind));
  if (!signalKinds.has("behavioral") || !signalKinds.has("qualitative")) {
    errors.push("evidence_contract.signals: research requires at least one behavioral and one qualitative signal");
  }

  const duplicateObservations = duplicates(observations.map((observation) => observation.id));
  if (duplicateObservations.length > 0) {
    errors.push(`evidence_contract.observations: duplicate ids: ${duplicateObservations.join(", ")}`);
  }

  for (const observation of observations) {
    for (const signalId of observation.signal_ids) {
      const signal = signals.find((candidate) => candidate.id === signalId);
      if (!signalIds.has(signalId)) {
        errors.push(`observation ${observation.id}: unknown signal id '${signalId}'`);
      } else if (!signal.source_types.includes(observation.source_type)) {
        errors.push(`observation ${observation.id}: source '${observation.source_type}' is not declared for signal '${signalId}'`);
      }
    }
  }

  const learningStatus = document.hivemind.learning_status;
  const learningRefs = document.evidence_contract.learning_refs;
  const coveredKinds = evidenceKindsCovered(document);

  if (learningStatus === "smol-evidence" && observations.length < 1) {
    errors.push("hivemind.learning_status: smol-evidence requires at least one captured observation");
  }
  if (["directionally-correct", "hypothesis-failed"].includes(learningStatus)) {
    if (observations.length < 1 || learningRefs.length < 1) {
      errors.push(`hivemind.learning_status: ${learningStatus} requires an observation and a learning reference`);
    }
  }
  if (learningStatus === "strongly-validated") {
    if (observations.length < 2 || learningRefs.length < 1) {
      errors.push("hivemind.learning_status: strongly-validated requires at least two observations and a learning reference");
    }
    if (!coveredKinds.has("behavioral") || !coveredKinds.has("qualitative")) {
      errors.push("hivemind.learning_status: strongly-validated must cover behavioral and qualitative signals");
    }
  }

  const exposure = document.exposure;
  if (exposure.kind === "research" && exposure.state === "default-on") {
    if (!["directionally-correct", "strongly-validated"].includes(learningStatus)) {
      errors.push("exposure: default-on research requires directionally-correct or strongly-validated outcome evidence");
    }
  }

  const componentRefs = duplicates(document.components.map((component) => component.ref));
  if (componentRefs.length > 0) {
    errors.push(`components: duplicate refs: ${componentRefs.join(", ")}`);
  }

  const todayMs = Date.parse(`${today}T00:00:00Z`);
  for (const component of document.components) {
    if (component.maturity !== "gold") continue;
    const productionMs = Date.parse(`${component.graduation.production_since}T00:00:00Z`);
    const ageDays = Math.floor((todayMs - productionMs) / 86_400_000);
    if (ageDays < 14) {
      errors.push(`component ${component.ref}: Gold requires 14 production days; found ${ageDays}`);
    }
  }

  return errors;
}

export function validateFlowMoment(document, options = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!isRealDate(today)) {
    return { valid: false, errors: ["today: expected a real calendar date in YYYY-MM-DD format"] };
  }
  const schemaValid = schemaValidator(document);
  const errors = schemaValid ? [] : schemaValidator.errors.map(formatSchemaError);
  if (schemaValid) errors.push(...semanticErrors(document, today));
  return { valid: errors.length === 0, errors };
}

export function renderFlowMoment(document) {
  const signals = document.evidence_contract.signals
    .map((signal) => `- **${signal.id}** (${signal.kind}): ${escapeMarkdownText(signal.question)}`)
    .join("\n");
  const exemplars = document.exemplars
    .map((item) => `- **${escapeMarkdownText(item.product)} — ${escapeMarkdownText(item.workflow_moment)}**\n  - Adopt: ${escapeMarkdownText(item.adopt)}\n  - Reject: ${escapeMarkdownText(item.reject)}\n  - Ref: ${item.ref}`)
    .join("\n");
  const components = document.components.length === 0
    ? "- None attached"
    : document.components.map((component) => `- ${component.ref} — **${component.maturity}**`).join("\n");

  return `# ${escapeMarkdownText(document.title)}

**Flow moment:** ${document.flow_moment_id}

**Record:** ${document.record_state}

**Outcome confidence:** ${document.hivemind.learning_status}

**Exposure:** ${document.exposure.kind} / ${document.exposure.state}

## Operator and progress

**Actor:** ${escapeMarkdownText(document.actor.role)} — ${escapeMarkdownText(document.actor.context)}

**Entry state:** ${escapeMarkdownText(document.entry_state)}

**Desired progress:** ${escapeMarkdownText(document.desired_progress)}

**Dream outcome:** ${escapeMarkdownText(document.dream_outcome)}

## Product hypothesis

${escapeMarkdownText(document.hypothesis.statement)}

Falsified or revised when:

${markdownBulletList(document.hypothesis.falsifiable_by)}

## Experience boundary

${escapeMarkdownText(document.experience.promise)}

${escapeMarkdownText(document.experience.recommendation_boundary)}

Available actions: ${document.experience.actions.join(", ")}.

## Evidence contract

${signals}

Captured observations: ${document.evidence_contract.observations.length}.

Learning references: ${document.evidence_contract.learning_refs.length}.

## Exposure contract

**Audience:** ${escapeMarkdownText(document.exposure.audience)}

**Owner:** ${escapeMarkdownText(document.exposure.owner)}

**Review trigger:** ${escapeMarkdownText(document.exposure.review_trigger)}

**Flag:** ${escapeMarkdownText(document.exposure.flag_ref ?? "not wired; dark hypotheses may remain unflagged")}

## Boundaries

Does:

${markdownBulletList(document.boundaries.does)}

Does not:

${markdownBulletList(document.boundaries.does_not)}

## Exemplars

${exemplars}

## Components

${components}

## Decision references

${document.decision_refs.length ? document.decision_refs.map((reference) => `- ${reference}`).join("\n") : "- None"}
`;
}

function collectFlowFiles(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return resolved.endsWith(".flow.json") ? [resolved] : [];
  return fs.readdirSync(resolved, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(resolved, entry.name);
      if (entry.isDirectory()) return collectFlowFiles(child);
      return entry.isFile() && entry.name.endsWith(".flow.json") ? [child] : [];
    })
    .toSorted();
}

function parseToday(args) {
  const index = args.indexOf("--today");
  if (index === -1) return new Date().toISOString().slice(0, 10);
  const value = args[index + 1];
  if (!isRealDate(value)) {
    throw new Error("--today requires YYYY-MM-DD");
  }
  return value;
}

function isRealDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function usage() {
  return `Usage:
  node tools/flow-moment.mjs validate [path] [--today YYYY-MM-DD]
  node tools/flow-moment.mjs render <file>`;
}

async function main(args) {
  const command = args[0];
  if (command === "validate") {
    const targetArg = args[1] && !args[1].startsWith("--") ? args[1] : DEFAULT_RECORDS_PATH;
    const files = collectFlowFiles(targetArg);
    if (files.length === 0) {
      console.error(`flow-moment: no .flow.json records found at ${targetArg}`);
      return 1;
    }
    const today = parseToday(args);
    let failures = 0;
    for (const file of files) {
      let document;
      try {
        document = readJson(file);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${path.relative(ROOT, file)}: invalid JSON: ${error.message}`);
        continue;
      }
      const result = validateFlowMoment(document, { today });
      if (result.valid) {
        console.log(`PASS ${path.relative(ROOT, file)}`);
      } else {
        failures += 1;
        console.error(`FAIL ${path.relative(ROOT, file)}`);
        for (const error of result.errors) console.error(`  - ${error}`);
      }
    }
    console.log(`Validated ${files.length} flow moment(s); ${failures} failed.`);
    return failures === 0 ? 0 : 1;
  }

  if (command === "render") {
    const file = args[1];
    if (!file) {
      console.error(usage());
      return 1;
    }
    const document = readJson(path.resolve(file));
    const result = validateFlowMoment(document);
    if (!result.valid) {
      console.error(`flow-moment: refusing to render invalid record\n${result.errors.map((error) => `  - ${error}`).join("\n")}`);
      return 1;
    }
    process.stdout.write(renderFlowMoment(document));
    return 0;
  }

  console.error(usage());
  return 1;
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`flow-moment: ${error.message}`);
      process.exitCode = 1;
    });
}
