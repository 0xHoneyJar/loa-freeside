#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const GOVERNANCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = path.join(GOVERNANCE_ROOT, "spec/product/system-component.schema.json");
const DEFAULT_PATH = "product/system-components";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(SCHEMA_PATH));
}

const schemaValidator = createValidator();

function formatSchemaError(error) {
  return `schema ${error.instancePath || "/"}: ${error.message}`;
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  }))];
}

function allReferences(document) {
  return [
    ...document.trust.contract_refs,
    ...document.trust.evidence_refs,
  ];
}

function semanticErrors(document, repoRoot) {
  const errors = [];
  const flowIds = document.flow_moments.map((moment) => moment.flow_moment_id);
  const duplicateFlows = duplicates(flowIds);
  if (duplicateFlows.length > 0) {
    errors.push(`flow_moments: duplicate ids: ${duplicateFlows.join(", ")}`);
  }

  for (const moment of document.flow_moments) {
    if (moment.canonical_ref !== `flow:${moment.flow_moment_id}`) {
      errors.push(`flow_moment ${moment.flow_moment_id}: canonical_ref must be flow:${moment.flow_moment_id}`);
    }
  }

  for (const reference of allReferences(document)) {
    if (!reference.startsWith("file:")) continue;
    const relative = reference.slice("file:".length).split("#", 1)[0];
    const resolved = path.resolve(repoRoot, relative);
    const insideRepo = resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`);
    if (!insideRepo) {
      errors.push(`reference ${reference}: local path escapes the repository root`);
    } else if (!fs.existsSync(resolved)) {
      errors.push(`reference ${reference}: local contract or evidence does not exist`);
    }
  }

  return errors;
}

export function validateSystemComponent(document, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const schemaValid = schemaValidator(document);
  const errors = schemaValid ? [] : schemaValidator.errors.map(formatSchemaError);
  if (schemaValid) errors.push(...semanticErrors(document, repoRoot));
  return { valid: errors.length === 0, errors };
}

export function renderSystemComponent(document) {
  const flows = document.flow_moments.length === 0
    ? `- Unmapped: ${document.unmapped_reason}`
    : document.flow_moments
      .map((moment) => `- **${moment.flow_moment_id}** (${moment.role}): ${moment.contribution}`)
      .join("\n");

  return `# ${document.component_id}

**Layer:** ${document.layer}

**Repository:** ${document.repository}

## Operator

${document.operator.role}: ${document.operator.job}

## Object and question

${document.object.description}

${document.question}

## Stable responsibility

${document.responsibility}

## Trust

Contract status: **${document.trust.contract_status}**

${document.trust.note}

## Flow moments

${flows}

## Boundary

Owns:

${document.boundaries.owns.map((item) => `- ${item}`).join("\n")}

Does not own:

${document.boundaries.does_not_own.map((item) => `- ${item}`).join("\n")}

Missing capability: ${document.boundaries.missing_capability_handoff}
`;
}

function collectFiles(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return resolved.endsWith(".system.json") ? [resolved] : [];
  return fs.readdirSync(resolved, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(resolved, entry.name);
      if (entry.isDirectory()) return collectFiles(child);
      return entry.isFile() && entry.name.endsWith(".system.json") ? [child] : [];
    })
    .toSorted();
}

function usage() {
  return `Usage:
  node tools/system-component.mjs validate [path]
  node tools/system-component.mjs render <file>`;
}

async function main(args) {
  const command = args[0];
  if (command === "validate") {
    const target = args[1] ?? DEFAULT_PATH;
    const files = collectFiles(target);
    if (files.length === 0) {
      console.error(`system-component: no .system.json manifests found at ${target}`);
      return 1;
    }
    let failures = 0;
    for (const file of files) {
      let document;
      try {
        document = readJson(file);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${path.relative(process.cwd(), file)}: invalid JSON: ${error.message}`);
        continue;
      }
      const result = validateSystemComponent(document, { repoRoot: process.cwd() });
      if (result.valid) {
        console.log(`PASS ${path.relative(process.cwd(), file)}`);
      } else {
        failures += 1;
        console.error(`FAIL ${path.relative(process.cwd(), file)}`);
        for (const error of result.errors) console.error(`  - ${error}`);
      }
    }
    console.log(`Validated ${files.length} system component(s); ${failures} failed.`);
    return failures === 0 ? 0 : 1;
  }

  if (command === "render") {
    const file = args[1];
    if (!file) {
      console.error(usage());
      return 1;
    }
    const document = readJson(path.resolve(file));
    const result = validateSystemComponent(document, { repoRoot: process.cwd() });
    if (!result.valid) {
      console.error(`system-component: refusing to render invalid manifest\n${result.errors.map((error) => `  - ${error}`).join("\n")}`);
      return 1;
    }
    process.stdout.write(renderSystemComponent(document));
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
      console.error(`system-component: ${error.message}`);
      process.exitCode = 1;
    });
}
