"use strict";
const fs   = require('fs');
const path = require('path');
const { validate } = require('./validate.js');

function projectRoot() { return path.resolve(__dirname, '..'); }

// Read a file and return it as a base64 data URI, or null if missing/invalid.
function fileToDataUri(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', svg: 'svg+xml', webp: 'webp' }[ext] || 'png';
  return 'data:image/' + mime + ';base64,' + buf.toString('base64');
}

// Assign draw numbers to main questions in a category.
// If drawOrder === 'explicit', honours q.draw values; otherwise shuffles.
function assignDrawNumbers(mains, drawOrder) {
  if (drawOrder === 'explicit') {
    // Sort by explicit draw number; fill gaps for any that are missing.
    const withDraw    = mains.filter((q) => q.draw != null).sort((a, b) => a.draw - b.draw);
    const withoutDraw = mains.filter((q) => q.draw == null);
    // Assign sequentially to those without explicit draw numbers.
    const usedNums = new Set(withDraw.map((q) => q.draw));
    let next = 1;
    for (const q of withoutDraw) {
      while (usedNums.has(next)) next++;
      q.draw = next++;
    }
    return [...withDraw, ...withoutDraw].sort((a, b) => a.draw - b.draw);
  }
  // Auto-shuffle: Fisher-Yates.
  const shuffled = mains.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffled.forEach((q, i) => { q.draw = i + 1; });
  return shuffled;
}

// Resolve logo entries from config.assets to either data URIs (embedImages) or paths.
function resolveLogos(config) {
  const root    = projectRoot();
  const embed   = config.questions && config.questions.embedImages !== false;
  const toSrc   = (file) => {
    if (!file || !file.trim()) return null;
    if (embed) return fileToDataUri(path.resolve(root, file));
    // Non-embed: store path relative to dist/, i.e., one level up from dist/
    return '../' + file.replace(/^\//, '');
  };

  const assets = config.assets || {};
  const resolvedCollabs = (assets.collaboratorLogos || []).map((cl) => ({
    src:   toSrc(cl.file || cl),
    alt:   cl.alt || '',
    scale: cl.scale || 1
  }));
  const resolvedSupporters = (assets.supporterLogos || []).map((sl) => ({
    src: toSrc(sl.file || sl),
    alt: sl.alt || ''
  }));
  const resolvedSponsors = (assets.sponsorLogos || []).map((sl) => ({
    src: toSrc(sl.file || sl),
    alt: sl.alt || ''
  }));

  return {
    primary:        toSrc(assets.organiserLogo),
    primaryAlt:     assets.organiserLogoAlt || '',
    secondary:      toSrc(assets.secondaryLogo),
    secondaryAlt:   assets.secondaryLogoAlt || '',
    titleSponsor:   toSrc(assets.titleSponsorLogo),
    titleSponsorAlt: assets.titleSponsorLogoAlt || '',
    collaborators:  resolvedCollabs,
    supporters:     resolvedSupporters,
    sponsors:       resolvedSponsors
  };
}

// Build the DATA object that is inlined into the runner template.
function buildData(config, questions) {
  const root    = projectRoot();
  const embed   = config.questions && config.questions.embedImages !== false;
  const imgDir  = config.questions && config.questions.imageDir
    ? path.resolve(root, config.questions.imageDir)
    : null;

  const drawOrder = (config.questions && config.questions.drawOrder) || 'auto';
  const cats = (config.categories || []).map((catConf) => {
    const catQuestions = questions.filter((q) => q.category === catConf.name);

    const toQuestionShape = (q) => {
      let imageData = null;
      if (q.imagePath && imgDir) {
        const imgPath = path.join(imgDir, q.imagePath);
        if (embed) {
          imageData = fileToDataUri(imgPath);
        } else {
          // Non-embedded: store relative path; runner uses imagePath relative to HTML location.
          imageData = q.imagePath;
        }
      }
      return {
        id:                q.id,
        theme:             q.theme,
        primaryQuestion:   q.primaryQuestion,
        primaryAnswer:     q.primaryAnswer,
        secondaryQuestion: q.secondaryQuestion || '',
        secondaryAnswer:   q.secondaryAnswer   || '',
        imageData:         imageData,
        imageIsPath:       !embed && !!q.imagePath  // flag for runner to distinguish path vs data URI
      };
    };

    let mains = catQuestions.filter((q) => q.type === 'main').map((q) => ({ ...q }));
    mains = assignDrawNumbers(mains, drawOrder);

    const boardSize  = (config.rules.teamsDefault || 4) * (config.rules.picksPerCategoryPerTeam || 2);
    const boardSlice = mains.slice(0, boardSize);  // only fill the board slots; extras become implicit buffer

    return {
      name:        catConf.name,
      shortName:   catConf.shortName || catConf.name.slice(0, 3).toUpperCase(),
      shortcutKey: catConf.shortcutKey || catConf.name.charAt(0).toUpperCase(),
      colour:      catConf.colour || 'blue',
      board:       boardSlice.map((q) => ({ draw: q.draw, ...toQuestionShape(q) })),
      tiebreakers: catQuestions.filter((q) => q.type === 'tiebreaker').map(toQuestionShape),
      backup:      catQuestions.filter((q) => q.type === 'backup').map(toQuestionShape)
    };
  });

  return {
    meta: {
      generatedAt:   new Date().toISOString(),
      runnerVersion: '1.0.0',
      imagePrefix:   embed ? '' : (config.questions && config.questions.imageDir ? '../' + config.questions.imageDir : '')
    },
    event: {
      title:            config.event.title || '',
      titleSecondary:   config.event.titleSecondary || '',
      festivalTitle:    config.event.festivalTitle || '',
      organiser:        config.event.organiser || '',
      collaborators:    config.event.collaborators || [],
      programSupporters: config.event.programSupporters || [],
      date:             config.event.date || '',
      dateLong:         config.event.dateLong || '',
      timeNote:         config.event.timeNote || '',
      venue:            config.event.venue || '',
      venueAddress:     config.event.venueAddress || '',
      coverLayout:      config.event.coverLayout || 'standard',
      pointsOriginal:   config.rules.pointsOriginal    || 10,
      pointsPassed:     config.rules.pointsPassed      || 5,
      timerSeconds:     config.rules.timerSeconds      || 30,
      passTimerSeconds: config.rules.passTimerSeconds  || 5,
      teamsMin:         config.rules.teamsMin          || 2,
      teamsMax:         config.rules.teamsMax          || 12,
      teamsDefault:     config.rules.teamsDefault      || 4,
      picksPerCategoryPerTeam: config.rules.picksPerCategoryPerTeam || 2,
      // Opening-team order: 'snake' (default) or 'circular'.
      openingOrder:     config.rules.openingOrder      || 'snake',
      // Penalty attempts per tied team before sudden death (default 3).
      tiebreakerPenaltyPerTeam: config.rules.tiebreakerPenaltyPerTeam != null ? config.rules.tiebreakerPenaltyPerTeam : 3,
      // Main-round passing on/off (default on). When off, a missed question
      // scores nobody; the tiebreaker pass mechanic is unaffected.
      passingEnabled:   config.rules.passingEnabled !== false
    },
    config: {
      secondaryLanguage: {
        enabled: !!(config.secondaryLanguage && config.secondaryLanguage.enabled),
        font:    (config.secondaryLanguage && config.secondaryLanguage.font) || '',
        colour:  (config.secondaryLanguage && config.secondaryLanguage.colour) || '#006e3c'
      },
      // Optional custom rulebook; when absent the runner generates default
      // sections from the configured rules. Each entry: { key, title, blurb, body[] }.
      rulebook: Array.isArray(config.rulebook) ? config.rulebook : null,
      // First-run operator toggles the wizard can preset. The runner copies
      // across only these known boolean keys (see defaultSettings()).
      defaultSettings: (function () {
        const d = config.defaults || {};
        const out = {};
        for (const k of ['autoReveal', 'audioOn', 'tbJumbled', 'showHintStrip']) {
          if (typeof d[k] === 'boolean') out[k] = d[k];
        }
        return out;
      })()
    },
    assets: {
      logos: resolveLogos(config)
    },
    categories: cats
  };
}

function main() {
  const { errors, warnings, info, config, questions } = validate();

  // Print validation output.
  info.forEach((m)     => console.log('ℹ [INFO]  ' + m));
  warnings.forEach((m) => console.log('⚠ [WARN]  ' + m));
  errors.forEach((m)   => console.log('✗ [ERROR] ' + m));

  if (errors.length) {
    console.error('\nBuild aborted: fix the errors above and re-run.');
    process.exit(1);
  }

  // Build DATA object.
  const data = buildData(config, questions);

  // Read runner template.
  const templatePath = path.join(projectRoot(), 'src', 'runner.html');
  if (!fs.existsSync(templatePath)) {
    console.error('src/runner.html not found — it should be part of this repository.');
    process.exit(1);
  }
  let html = fs.readFileSync(templatePath, 'utf8');

  // Inline the DATA JSON. Escape </ to prevent the browser from closing the
  // <script> tag early when the JSON contains HTML content.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  html = html.replace('{{DATA}}', json);

  // Write output.
  const outDir  = path.join(projectRoot(), 'dist');
  const outFile = path.join(outDir, 'QuizRunner.html');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');

  const totalQ = data.categories.reduce((n, c) => n + c.board.length + c.tiebreakers.length + c.backup.length, 0);
  console.log('\n✓ Built dist/QuizRunner.html');
  console.log('  ' + data.categories.length + ' categories · ' + totalQ + ' questions total');
  if (warnings.length) console.log('  ' + warnings.length + ' warning(s) — review above before the event.');
}

main();
