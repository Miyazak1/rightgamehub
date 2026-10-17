# Gold-standard courseware shell starter

Copy `index.html` into a new courseware package and replace only the marked subject-owned regions. Keep the three experience IDs (`textbook`, `sandbox`, `signal`), the three view IDs (`explore`, `model`, `analyse`), and the shell role classes.

The starter intentionally contains no mathematics, physics, chemistry, assessment, or simulation logic. A new package supplies those through hot-swappable domain, instrument, challenge, journey, and embed modules.

Release checklist:

1. Add one purposeful journey for every cell in `profile.json`.
2. Keep locale control in the host and localize every `[data-copy]` node.
3. Export and restore mode, view, variables, attempts, answers, and saved evidence through Embed v2.
4. Run UI Kit audit, Courseware Doctor, production build, and real-browser responsive checks.
