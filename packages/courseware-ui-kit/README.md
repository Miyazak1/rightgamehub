# MOOYU Courseware UI Kit

The UI Kit is the shared presentation contract for embedded MOOYU courseware. It is intentionally smaller than a component framework: subject packages keep ownership of their experiment, diagrams, models, and analysis views while the kit owns the shell geometry and visual rhythm.

## Shell contract

The courseware root declares `data-mooyu-scene`. When `component.courseware-ui` activates it adds `data-courseware-shell="v1"` and the selected density.

The standard shell uses these roles:

- `.top`: brand, experience switch, view switch, and readiness state.
- `.segments`: textbook, sandbox, and challenge modes.
- `.views`: explore, model, and analyse stages.
- `.tools`: one bounded construction row, or two compact rows when the shell declares `data-toolbar-rows="2"`. Children must never exceed their row.
- `.lesson`: the subject-owned learning surface.
- `.workspace`: experiment and evidence regions.
- `.transport`: playback and experiment progress.

Aliases prefixed with `.cw-` are available for new courseware so new packages do not need to inherit historical class names.

## Invariants

- The embedded courseware does not render its own language switch; the host owns locale selection.
- At desktop widths of 1280 px and above, the shell is one viewport high and the document does not scroll.
- Single-row toolbar controls are 54 px high in the compact density. A declared two-row toolbar uses a 100 px shelf with 40 px controls (92/36 px in short desktop viewports), so its rows cannot collide.
- The primary simulation action lives in the transport bar. Toolbar actions remain visually secondary.
- Courseware keeps a minimal inline fallback so an unavailable optional UI module never makes the lesson unusable.

The module is `live` hot-swappable. A release carries its own verified copy under `modules/ui-kit/`; tests keep that release copy byte-identical to this canonical source.

`auditCoursewareLayout(root)` is the browser-side layout gate. It reports horizontal shell overflow, overlap between the header/toolbar/lesson/transport regions, collisions between toolbar rows, and toolbar controls escaping their shelf. Acceptance tests should run it at representative wide, standard, tablet, and short viewport sizes.

Historical reference packages may use `.workbench-nav`, `.experience-switch`, `.mode-tabs`, `.tool-shelf`, and `.lesson-panel`. These are first-class compatibility aliases, not separate shells. New packages should prefer the `.cw-` role names.

## Gold-standard courseware profile

`auditGoldStandardCourseware(root)` turns the shared shell into a reusable release gate. A gold-standard courseware package must expose all three experience modes and all three learning views, producing a deliberate 3 × 3 matrix rather than nine labels that lead to the same content.

| | Explore | Model | Analyse |
| --- | --- | --- | --- |
| Textbook | guided prediction and observation | connect equations to representations | read evidence against the learning objective |
| Sandbox | open investigation with freely adjustable variables | explain or derive the relationships being explored | compare saved trials while changing one variable at a time |
| Challenge | show the goal, constraints, attempts, and immediate feedback | expose the calculations needed to plan a solution | preserve and explain success or failure evidence |

The profile also requires:

- Host-owned locale switching with all static and dynamic copy using the same dictionary.
- Embed v2 state export and restore for parameters, locale, active view, answers, attempts, and saved trials.
- At least one `aria-live` feedback surface, visible keyboard focus, semantic graph labels, reduced-motion behavior, and usable narrow/short viewport layouts.
- A journey for every matrix cell plus a second-locale completion journey.

Courseware-specific physics, mathematics, chemistry, or game logic remains outside the UI Kit. The profile checks the product contract around that logic; it does not turn the UI Kit into a domain engine.

`GOLD_STANDARD_MATRIX` is the canonical machine-readable list of the nine cells. Creator tooling and package tests should derive their release gates from it instead of maintaining subject-specific copies.
