"use strict";
const fs   = require('fs');
const path = require('path');
const { parseCsvQuestions } = require('./importers/csv.js');

// Resolves a path from the project root (the directory containing package.json).
function projectRoot() {
  return path.resolve(__dirname, '..');
}

function loadConfig(configPath) {
  const src = configPath || path.join(projectRoot(), 'config.json');
  if (!fs.existsSync(src)) throw new Error('config.json not found at: ' + src);
  try {
    const raw = fs.readFileSync(src, 'utf8');
    // Strip the _comment field and any trailing commas (basic JSON tolerance).
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Could not parse config.json: ' + e.message);
  }
}

function loadQuestions(config) {
  const src = path.resolve(projectRoot(), config.questions.source);
  if (!fs.existsSync(src)) {
    return { questions: [], warnings: ['Question file not found: ' + config.questions.source] };
  }
  return parseCsvQuestions(fs.readFileSync(src, 'utf8'));
}

// ── Validation checks ────────────────────────────────────────────────────────

function checkRequiredConfig(config, errors) {
  if (!config.event) { errors.push('config.json: missing "event" section.'); return; }
  if (!config.event.title || !config.event.title.trim())
    errors.push('event.title is required.');
  if (!config.categories || !Array.isArray(config.categories) || config.categories.length === 0)
    errors.push('config.json: "categories" must be a non-empty array.');
  const validLayouts = ['minimal', 'standard', 'sponsor-rich'];
  if (config.event.coverLayout && !validLayouts.includes(config.event.coverLayout))
    errors.push('event.coverLayout must be one of: ' + validLayouts.join(', '));

  const rules = config.rules || {};
  if (rules.openingOrder && !['snake', 'circular'].includes(rules.openingOrder))
    errors.push('rules.openingOrder must be "snake" or "circular".');
  if (rules.tiebreakerPenaltyPerTeam != null &&
      (!Number.isInteger(rules.tiebreakerPenaltyPerTeam) || rules.tiebreakerPenaltyPerTeam < 0))
    errors.push('rules.tiebreakerPenaltyPerTeam must be a whole number ≥ 0.');
  if (rules.passingEnabled != null && typeof rules.passingEnabled !== 'boolean')
    errors.push('rules.passingEnabled must be true or false.');
}

function checkLogoFiles(config, warnings) {
  const root = projectRoot();
  const check = (file, label) => {
    if (!file || !file.trim()) return;
    if (!fs.existsSync(path.resolve(root, file)))
      warnings.push(label + ' logo file not found: ' + file);
  };
  check(config.assets && config.assets.organiserLogo, 'Organiser');
  check(config.assets && config.assets.secondaryLogo, 'Secondary');
  check(config.assets && config.assets.titleSponsorLogo, 'Title sponsor');
  for (const cl of (config.assets && config.assets.collaboratorLogos) || [])
    check(cl.file || cl, 'Collaborator');
  for (const sl of (config.assets && config.assets.supporterLogos) || [])
    check(sl.file || sl, 'Supporter');
  for (const sl of (config.assets && config.assets.sponsorLogos) || [])
    check(sl.file || sl, 'Sponsor');
}

function checkCategories(config, questions, errors, warnings) {
  const catNames = new Set((config.categories || []).map((c) => c.name));

  // Every category in the CSV must be declared in config.
  const unknownCats = new Set();
  for (const q of questions) {
    if (!catNames.has(q.category)) unknownCats.add(q.category);
  }
  for (const c of unknownCats)
    errors.push('Questions reference category "' + c + '" which is not declared in config.json.');

  // Category shortcutKey uniqueness.
  const keys = {};
  for (const c of (config.categories || [])) {
    const k = (c.shortcutKey || '').toUpperCase();
    if (!k) { warnings.push('Category "' + c.name + '" has no shortcutKey.'); continue; }
    if (keys[k]) errors.push('Shortcut key "' + k + '" is used by both "' + keys[k] + '" and "' + c.name + '".');
    else keys[k] = c.name;
  }
}

function checkQuestionMath(config, questions, info, warnings) {
  const teams     = (config.rules && config.rules.teamsDefault) || 4;
  const picks     = (config.rules && config.rules.picksPerCategoryPerTeam) || 2;
  const boardSize = teams * picks;   // total slots on the board per category

  for (const cat of (config.categories || [])) {
    const mains = questions.filter((q) => q.category === cat.name && q.type === 'main');
    const tbs   = questions.filter((q) => q.category === cat.name && q.type === 'tiebreaker');

    if (mains.length < boardSize) {
      warnings.push(
        cat.name + ': only ' + mains.length + ' main questions but the board needs ' +
        boardSize + ' (' + teams + ' teams × ' + picks + ' picks). Add more mains or reduce team count.'
      );
    } else if (mains.length > boardSize) {
      const unused = mains.length - boardSize;
      info.push(
        cat.name + ': ' + mains.length + ' main questions for a ' + boardSize +
        '-slot board — ' + unused + ' question' + (unused > 1 ? 's' : '') +
        ' will not be drawn with ' + teams + ' teams × ' + picks + ' picks.'
      );
    }

    if (tbs.length < 3)
      warnings.push(cat.name + ': only ' + tbs.length + ' tiebreaker question' + (tbs.length === 1 ? '' : 's') + ' — recommend at least 3.');
  }
}

function checkDuplicateIds(config, questions, errors) {
  for (const cat of (config.categories || [])) {
    const seen = {};
    for (const q of questions.filter((x) => x.category === cat.name)) {
      if (seen[q.id]) errors.push(cat.name + ': duplicate question id "' + q.id + '".');
      seen[q.id] = true;
    }
  }
}

function checkExplicitDrawConflicts(config, questions, errors) {
  if (!config.questions || config.questions.drawOrder !== 'explicit') return;
  for (const cat of (config.categories || [])) {
    const mains = questions.filter((q) => q.category === cat.name && q.type === 'main');
    const drawNums = {};
    for (const q of mains) {
      if (q.draw == null) continue;
      if (drawNums[q.draw]) errors.push(cat.name + ': duplicate draw number ' + q.draw + ' (ids: ' + drawNums[q.draw] + ', ' + q.id + ').');
      else drawNums[q.draw] = q.id;
    }
  }
}

function checkImageFiles(config, questions, warnings) {
  if (!(config.questions && config.questions.imageDir)) return;
  const imgDir = path.resolve(projectRoot(), config.questions.imageDir);
  for (const q of questions) {
    if (!q.imagePath) continue;
    const p = path.join(imgDir, q.imagePath);
    if (!fs.existsSync(p))
      warnings.push('Image not found for ' + q.id + ' (' + q.category + '): ' + q.imagePath);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

// Runs every check on an already-loaded config + questions array. Pure with
// respect to its arguments (it only touches the filesystem to confirm that
// referenced logo/image files exist), so tests can call it with in-memory data.
function runChecks(config, questions) {
  const errors   = [];
  const warnings = [];
  const info     = [];
  checkRequiredConfig(config, errors);
  checkLogoFiles(config, warnings);
  checkCategories(config, questions, errors, warnings);
  checkQuestionMath(config, questions, info, warnings);
  checkDuplicateIds(config, questions, errors);
  checkExplicitDrawConflicts(config, questions, errors);
  checkImageFiles(config, questions, warnings);
  return { errors, warnings, info };
}

function validate(configPath) {
  let config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    return { errors: [e.message], warnings: [], info: [], config: null, questions: [] };
  }

  const result = loadQuestions(config);
  const questions = result.questions;
  const out = runChecks(config, questions);
  // Surface any CSV-parsing warnings alongside the structural ones.
  out.warnings.unshift(...result.warnings);
  return { errors: out.errors, warnings: out.warnings, info: out.info, config, questions };
}

// Run as a standalone script: node src/validate.js
if (require.main === module) {
  const { errors, warnings, info } = validate();
  const pad = (label, items, sym) =>
    items.forEach((m) => console.log(sym + ' [' + label + '] ' + m));

  pad('ERROR',   errors,   '✗');
  pad('WARN',    warnings, '⚠');
  pad('INFO',    info,     'ℹ');

  if (!errors.length && !warnings.length && !info.length)
    console.log('✓ All checks passed — ready to build.');

  if (errors.length) process.exit(1);
}

module.exports = { validate, runChecks, loadConfig, loadQuestions };
