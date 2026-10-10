# Quiz Runner

A configurable, **single-file** HTML quiz-competition runner for community events.
Pick categories, add teams, open questions in a fair snake order, run a per-question
timer with a call-bell, handle passes, score automatically, break ties, and export
the results — all from one HTML file that works offline.

The finished `QuizRunner.html` has everything embedded (questions, images, logos),
so you can email it, drop it on a USB stick, or host it on a static website. No
internet connection is needed to run a quiz.

---

## Two ways to build your quiz

### 1. The Setup Wizard (recommended — no coding)

Open **`setup.html`** in a browser and follow the seven steps:

1. **Event** — title, date, venue, cover layout, optional second language.
2. **Logos** — upload organiser/sponsor/supporter logos (all optional).
3. **Categories** — one category per round, each with a colour and a shortcut key.
4. **Rules** — team counts, questions per team, timer, points, opening order,
   passing on/off, tiebreaker, and operator defaults. Each setting shows a live
   worked example so you can see exactly what it does on the night.
5. **Rulebook** — the on-screen rules participants read; pre-filled from your
   settings, fully editable (reword, add, or remove rules).
6. **Questions** — upload a CSV (download a sample from inside the wizard).
7. **Review** — fix any errors, then download your `QuizRunner.html`.

The root `setup.html` is **fully self-contained** (the runner template is embedded
inside it), so it works both ways: **double-click it** to run locally, or push it to
a website. If you ever change `src/runner.html` or `src/setup.html`, regenerate it:

```bash
npm run build:setup     # rebuilds the root setup.html from src/
```

### 2. The command line (for technical users)

Requires **Node.js 18+**. No dependencies to install.

```bash
# Out of the box this builds from questions/sample.csv so you can try it first.
# 1. Edit config.json, then point questions.source at your own CSV.
# 2. Check everything lines up:
npm run validate
# 3. Build the single-file runner into dist/QuizRunner.html:
npm run build
```

`dist/QuizRunner.html` is your finished quiz. Open it in any modern browser.

---

## The question CSV

One row per question. The first row must be the header. Columns:

| Column              | Required | Notes                                                           |
| ------------------- | -------- | --------------------------------------------------------------- |
| `id`                | yes      | Unique within its category, e.g. `Q1`.                          |
| `category`          | yes      | Must match a category name in your config exactly.              |
| `type`              | yes      | `main`, `tiebreaker`, or `backup`.                              |
| `theme`             | no       | A short tag shown beside the question.                          |
| `primaryQuestion`   | yes      | The question text.                                              |
| `primaryAnswer`     | yes      | The answer text.                                                |
| `secondaryQuestion` | no       | Second-language question (only shown if enabled).               |
| `secondaryAnswer`   | no       | Second-language answer.                                         |
| `imagePath`         | no       | Image filename, e.g. `koala.jpg`.                               |
| `draw`              | no       | Fixed board position (only used when draw order is `explicit`). |

Wrap any value containing a comma in double quotes. To include a literal double
quote inside a value, double it (`""`).

**How many do you need?** Each category's board has `default teams × questions per
team` slots. With 4 teams and 2 questions each that is 8 main questions per category.
Extra mains become a buffer and are simply not drawn — the validator tells you how
many will go unused. At least 3 tiebreakers per category is recommended.

A ready-to-edit example lives in [`questions/sample.csv`](questions/sample.csv).

---

## Configuration reference (`config.json`)

```jsonc
{
  "event": {
    "title": "Community Quiz Competition",
    "titleSecondary": "", // second-language title (optional)
    "festivalTitle": "", // shown above the title on the cover
    "organiser": "My Organisation",
    "collaborators": ["Partner Org"],
    "programSupporters": ["Council"],
    "dateLong": "Saturday, 1 August 2026",
    "timeNote": "10:00 AM",
    "venue": "Community Hall",
    "venueAddress": "1 Main Street, City",
    "coverLayout": "standard", // "minimal" | "standard" | "sponsor-rich"
  },
  "assets": {
    // file paths, relative to this folder
    "organiserLogo": "assets/logos/organiser.png",
    "secondaryLogo": "",
    "titleSponsorLogo": "",
    "collaboratorLogos": [
      { "file": "assets/logos/partner.png", "alt": "Partner" },
    ],
    "supporterLogos": [],
    "sponsorLogos": [],
  },
  "rules": {
    "teamsDefault": 4,
    "teamsMin": 2,
    "teamsMax": 12,
    "picksPerCategoryPerTeam": 2,
    "timerSeconds": 30,
    "passTimerSeconds": 5,
    "pointsOriginal": 10,
    "pointsPassed": 5,
    "openingOrder": "snake", // "snake" (1..n,n..1) or "circular" (1..n,1..n)
    "tiebreakerPenaltyPerTeam": 3, // penalty questions per tied team before sudden death
    "passingEnabled": true, // false = a missed question scores nobody (no passing)
  },
  "defaults": {
    // first-run operator toggles (the operator can still change these in-game)
    "autoReveal": true, // reveal the answer automatically after scoring
    "audioOn": true, // play the call-bell sound
    "tbJumbled": true, // one combined tiebreaker pool (false = per-category)
    "showHintStrip": true, // show the keyboard-shortcut hint strip
  },
  "categories": [
    {
      "name": "General Knowledge",
      "shortName": "GK",
      "shortcutKey": "G",
      "colour": "blue",
    },
  ],
  "questions": {
    "source": "questions/questions.csv",
    "imageDir": "questions/images/",
    "embedImages": true, // embed images as data URIs (portable)
    "drawOrder": "auto", // "auto" (shuffle) | "explicit" (use draw column)
  },
  "secondaryLanguage": { "enabled": false, "font": "", "colour": "#006e3c" },
}
```

Available tile **colours**: `blue`, `green`, `amber`, `teal`, `purple`, `rose`.

**Cover layouts**

- `minimal` — title, date, and venue only.
- `standard` — festival line, organiser logo, collaborators, and a supporters footer.
- `sponsor-rich` — the title sponsor sits prominently at the top; all other sponsors
  and supporters are grouped in the footer.

**Opening order** — `snake` rotates `1,2,…,n,n,…,1` and reverses each round so no
team always opens first; `circular` repeats `1,2,…,n` the same way every round.

**Tiebreaker** — when teams tie for first, each tied team gets
`tiebreakerPenaltyPerTeam` penalty questions; if still tied, sudden death follows
(the operator declares the winner once one emerges).

**Passing** — by default a missed question passes to the other teams for
`pointsPassed`. Set `passingEnabled` to `false` for a "your question only" format:
a miss closes the question immediately and scores nobody. The tiebreaker keeps
its own pass-elimination mechanic in sudden death regardless of this setting.

**Operator defaults** (`defaults`) — the first-run state of four in-game toggles.
They are baked into the quiz file, but the operator can still change them during
the quiz under Settings (<kbd>O</kbd>); once changed, the operator's choice is
remembered by that browser.

**Rulebook** — by default the on-screen rulebook is generated from these settings.
To customise the wording, edit it in the setup wizard's **Rulebook** step, or set a
`"rulebook"` array in `config.json` (`[{ "key", "title", "blurb", "body": [...] }]`).
Keep it consistent with your settings.

---

## Running a quiz

1. Open `QuizRunner.html` in Chrome, Firefox, or Safari (double-click it).
2. On the **cover**, press <kbd>Enter</kbd> to reach team setup; enter team names and
   start.
3. Open a category, confirm the opening team (suggested in snake order), pick a slot,
   start the timer with <kbd>Space</kbd>, then mark the answer <kbd>G</kbd>ood or
   <kbd>W</kbd>rong. Passes are handled automatically.
4. <kbd>F</kbd> toggles presentation mode (hides the operator bar); <kbd>?</kbd> shows
   all shortcuts.

Useful in-quiz features:

- **Rename teams / add a late team** — Settings (<kbd>O</kbd>). Renaming keeps all
  scores; adding a team mid-game warns you because it changes the snake order.
- **Export results** — the Leaderboard (<kbd>L</kbd>) has an _Export results (CSV)_
  button.
- **Snapshots** — Settings can save/load the full quiz state to a file as a backup.
  State also auto-saves to the browser, so a refresh never loses scores.

---

## Saving, loading, and what hosting does (and doesn't) give you

The runner is a **static, client-side app** — there is no server or database.

- **Auto-save:** every action saves to the browser's `localStorage`. A refresh, an
  accidental tab close, or reopening the file later all keep team names and scores.
- **Manual backup:** Settings → _Save snapshot_ downloads the full quiz state as a
  JSON file; _Load snapshot_ restores it (handy for moving between machines).
- **Per-browser, per-device:** saved state lives in the browser that ran the quiz. It
  does **not** sync between devices or between different people. Hosting on a website
  lets anyone open the page and run their own quiz with their own saved scores, but it
  is **not** a shared live scoreboard — that would require a backend. For one operator
  on the projector laptop, it behaves exactly like a save/load app.

### Hosting on GitHub Pages

1. Push this repository to GitHub.
2. Enable **Pages** (Settings → Pages → deploy from the default branch).
3. Visit `https://<you>.github.io/<repo>/setup.html`.

The root `setup.html` is self-contained, so it works the same online as it does on a
double-click. Commit it whenever you regenerate it with `npm run build:setup`.

A `.nojekyll` file is included so GitHub Pages serves the HTML as-is (without this,
Jekyll would try to process the `{{DATA}}` / template placeholders in `src/`).

### One-step deploy

Once the repository has a GitHub remote with Pages enabled, a single command
rebuilds every generated file, commits, and pushes — and Pages redeploys the live
site automatically:

```bash
npm run deploy                 # commits with a dated message, then pushes
npm run deploy -- "your note"  # custom commit message
```

The build stamps a fresh "generated at" time into the sample quiz, so a deploy
normally produces one commit; it only skips the push if there is genuinely
nothing staged (e.g. re-running after a push that already went through). The live
wizard lands at `https://<you>.github.io/quiz-runner/`.

---

## Sharing results after an event

`results.html` turns a saved snapshot into a clean, read-only results page — the final
standings (ranked on round points, with the tiebreaker winner noted) and a **Complete
Game Log** grouped by round and shown in the real order questions were played. It needs
no build step.

Opening `results.html` with no parameters shows a **hub**: any published quizzes plus
an _Open a snapshot file_ button. It works two ways:

- **Offline:** open `results.html`, open the JSON you saved from the runner
  (Settings → _Save snapshot_). Print or "Save as PDF" to share.
- **On a website:** link to `results.html?src=path/to/snapshot.json`. To list a quiz on
  the hub, drop its snapshot JSON in `results/` and add a row to `results/manifest.json`:

  ```json
  { "quizzes": [
    {
      "title": "Community Quiz 2026",
      "date": "1 Aug 2026",
      "venue": "Community Hall",
      "file": "results/community-2026.json",
      "playUrl": "examples/community-2026.html"
    }
  ] }
  ```

  | Field | Required | Purpose |
  | ----- | -------- | ------- |
  | `title` | yes | Displayed as the entry heading. |
  | `date` | no | Shown below the title. |
  | `venue` | no | Shown below the title, after the date. |
  | `file` | no* | Path to the results snapshot JSON — adds a **Results →** link. |
  | `playUrl` | no* | Path to a playable quiz HTML — adds a **Play →** link. |

  *At least one of `file` or `playUrl` should be present, otherwise the entry shows no links.

  To add your event: open a pull request with any files you want to host (snapshot JSON in
  `results/`, playable HTML in `examples/`) and the updated `manifest.json`.

Snapshots are self-describing (they embed the event name, category labels, and the
play order), so the results page renders correctly without the original quiz file.
Older snapshots still work — the viewer falls back to inferring what it can.

## Entry points

`index.html` is the landing page, offering three paths: **build your own** quiz
(`setup.html`), **try the sample** (`examples/sample-quiz.html`), and **view past
results** (`results.html`). `npm run build:site` regenerates everything that derives
from the runner (the built sample, and the embedded wizard) in one command.

---

## Project layout

```
quiz-runner/
├── index.html              # landing page (build / try sample / view results)
├── setup.html              # the no-code Setup Wizard — self-contained (generated)
├── results.html            # results hub + read-only viewer
├── config.json             # configuration for the command-line build
├── questions/
│   ├── sample.csv          # example questions
│   └── images/             # optional question images
├── assets/logos/           # optional logo files
├── examples/
│   └── sample-quiz.html    # a built, ready-to-run sample quiz (generated)
├── results/
│   ├── manifest.json       # list of published quizzes shown on the hub
│   └── *.json              # published snapshots
├── src/
│   ├── runner.html         # the runner template ({{DATA}} is injected at build)
│   ├── setup.html          # editable wizard source ({{RUNNER_TEMPLATE_B64}} placeholder)
│   ├── build.js            # config + CSV → dist/QuizRunner.html
│   ├── build-setup.js      # embeds runner.html into the root setup.html
│   ├── validate.js         # pre-build checks
│   └── importers/csv.js    # CSV parser
├── tests/                  # node --test unit tests + fixtures
└── dist/                   # build output (git-ignored)
```

> Edit the wizard at `src/setup.html` and the runner at `src/runner.html`, then run
> `npm run build:site` to regenerate the root `setup.html` and `examples/sample-quiz.html`.
> Those generated files are committed so the site can be hosted and shared.

Run the tests with `npm test`.

## How this was built

This project was **vibecoded with [Claude](https://claude.com/claude-code)** — the
implementation plan, the runner refactor, the build tooling, and the setup wizard
were written collaboratively with Claude (model **Opus 4.8**, via Claude Code) in
May–June 2026, working from my own design brief and requirements.

Every release is then rigorously tested by me before it is used
to run a real event. The automated checks (`npm test`) cover the build and validation
logic; the gameplay itself is verified by hand against a written test checklist
(timer, passing, scoring, tiebreakers, save/reload, and export) on the actual quiz
hardware.

I run quizzes like these for Nepalese community organisations from time to time, and
templatised the tooling so others can do the same.

## Licence

MIT.
