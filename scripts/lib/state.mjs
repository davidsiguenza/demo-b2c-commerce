#!/usr/bin/env node
/**
 * state.mjs — read / write / validate demo-state.json for the
 * Demo B2C Commerce orchestrator. Zero dependencies.
 *
 * The master skill uses these helpers to keep the 11-step flow resumable:
 *   - load(cwd)          -> parsed state (creates from template if absent)
 *   - save(cwd, state)   -> persist (pretty-printed)
 *   - validate(state)    -> { ok, errors[] } against demo-state.schema.json
 *   - nextStep(state)    -> first step whose status is not done/skipped, or null
 *   - setStatus(state, id, status, note?) -> mutates + returns state
 *
 * CLI usage (used by the Phase-0 verification):
 *   node scripts/lib/state.mjs validate [path-to-state.json]
 *   node scripts/lib/state.mjs next     [path-to-state.json]
 *
 * Defaults to ./demo-state.json in the cwd. When validating with no file
 * present, falls back to templates/demo-state.example.json so the schema
 * can be smoke-tested in CI without a real run.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCHEMA_PATH = join(__dirname, 'demo-state.schema.json');
const TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'demo-state.example.json');
const STATE_FILENAME = 'demo-state.json';

const STEP_ORDER = [
  '1_sandbox', '2_site', '3_storefront_bm', '4_slas_creds',
  '5_deploy_sfn', '6_branding', '7_pd_template', '8_pd_content',
  '9_catalog_build', '10_catalog_upload', '11_reindex_push',
];

const VALID_STATUS = ['pending', 'in_progress', 'done', 'skipped', 'blocked'];
const VALID_OWNER = ['user', 'ia'];

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export function statePath(cwd = process.cwd()) {
  return join(cwd, STATE_FILENAME);
}

/** Load demo-state.json from cwd; create it from the template if missing. */
export function load(cwd = process.cwd()) {
  const p = statePath(cwd);
  if (!existsSync(p)) {
    const seed = readFileSync(TEMPLATE_PATH, 'utf8');
    writeFileSync(p, seed);
    return JSON.parse(seed);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function save(cwd, state) {
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2) + '\n');
  return state;
}

// ---------------------------------------------------------------------------
// Validation — minimal, schema-aware, zero-dep
// ---------------------------------------------------------------------------

/** Validate a state object against the required shape. Returns { ok, errors }. */
export function validate(state) {
  const errors = [];
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

  for (const key of schema.required) {
    if (!(key in state)) errors.push(`missing top-level key: ${key}`);
  }

  // steps block: every step present, owner/status in enum
  const steps = state.steps || {};
  for (const id of STEP_ORDER) {
    const step = steps[id];
    if (!step) { errors.push(`missing step: ${id}`); continue; }
    if (!VALID_OWNER.includes(step.owner)) {
      errors.push(`step ${id}: invalid owner '${step.owner}'`);
    }
    if (!VALID_STATUS.includes(step.status)) {
      errors.push(`step ${id}: invalid status '${step.status}'`);
    }
    if (step.owner === 'ia' && !step.skill) {
      errors.push(`step ${id}: ia-owned step must declare a 'skill'`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// State machine helpers
// ---------------------------------------------------------------------------

/** First step not yet done/skipped, in canonical order. null when all complete. */
export function nextStep(state) {
  for (const id of STEP_ORDER) {
    const s = state.steps?.[id]?.status;
    if (s !== 'done' && s !== 'skipped') return id;
  }
  return null;
}

export function setStatus(state, id, status, note) {
  if (!state.steps?.[id]) throw new Error(`unknown step: ${id}`);
  if (!VALID_STATUS.includes(status)) throw new Error(`invalid status: ${status}`);
  state.steps[id].status = status;
  if (note !== undefined) state.steps[id].note = note;
  return state;
}

export { STEP_ORDER };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const [cmd, fileArg] = process.argv.slice(2);
  const target = fileArg
    ? resolve(fileArg)
    : (existsSync(statePath()) ? statePath() : TEMPLATE_PATH);

  const state = JSON.parse(readFileSync(target, 'utf8'));

  if (cmd === 'validate' || cmd === undefined) {
    const { ok, errors } = validate(state);
    if (ok) {
      console.log(`✓ ${target} is valid (${STEP_ORDER.length} steps).`);
      process.exit(0);
    }
    console.error(`✗ ${target} is INVALID:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  } else if (cmd === 'next') {
    const id = nextStep(state);
    console.log(id ? `Next step: ${id} (${state.steps[id].owner})` : 'All steps complete.');
    process.exit(0);
  } else {
    console.error(`Unknown command: ${cmd}\nUsage: state.mjs [validate|next] [path]`);
    process.exit(2);
  }
}
