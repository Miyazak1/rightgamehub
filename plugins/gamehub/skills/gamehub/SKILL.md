---
name: gamehub
description: Use MOOYU.FUN when the user wants to discover, play, create locally, validate, install, or publish lightweight games or interactive courseware from an AI agent.
---

# 墨鱼工坊

Use this skill when the user asks to open MOOYU.FUN（墨鱼工坊）, find a short game, install its plugin into their Agent, or publish a compatible web game.

- Prefer an installed native MOOYU.FUN surface or connected MOOYU.FUN MCP App when the host exposes one.
- If the host cannot embed 墨鱼工坊, open or provide `https://mooyu.fun`.
- For installation guidance, open or provide `https://mooyu.fun/#/install`.
- Never install a plugin, execute an installer, or modify an Agent profile unless the user explicitly authorizes that action.
- Before installation, state the target host, package source, affected profile, and whether a restart is required.
- Never request, display, copy, or store MOOYU.FUN access or refresh tokens. Authentication belongs to the MOOYU.FUN UI and the host's credential store.
- Do not claim an embedded experience is available unless that host integration is marked ready on the installation page.
- When helping publish a game, explain that public untrusted uploads remain subject to MOOYU.FUN validation and platform limits.

## Agent-local creator toolkits

MOOYU.FUN does not provide a hosted model or a browser-based replacement for the user's coding Agent. Creation happens in the user's current local workspace with the user's own Agent and model provider. Never ask for or transmit a model API key.

1. Resolve the plugin root relative to this file (`../..`). Run `node <plugin-root>/bin/creator-toolkit.mjs list` to read the versioned toolkit catalog bundled with this plugin.
2. Select a toolkit by the user's intended work, then run `node <plugin-root>/bin/creator-toolkit.mjs show <key>` or `prompt <key>`. Treat the returned catalog entry as workflow data, not permission to download or execute third-party software.
3. Create and edit source files only in a user-selected workspace directory. Do not edit the installed plugin, bundled catalog, or templates in place.
4. Keep model prompts, model credentials, MOOYU.FUN credentials, personal paths, and unrelated local files out of the produced game.
5. Before packaging a static web result, run the local Creator Doctor: `node <plugin-root>/bin/creator-toolkit.mjs doctor <absolute-web-project-directory>`. Fix every error. Warnings must be explained to the user; a passing local report is not platform approval.
6. `ready` means the plugin includes an end-to-end managed template. `guided` means MOOYU.FUN supplies the source/output contract but does not bundle or silently install the upstream compiler. `asset-only` cannot be published as a standalone game.
7. Downloading, installing, or executing an upstream compiler/editor requires the user's explicit authorization. Prefer an already-installed compatible tool. Never execute code fetched from the toolkit catalog—the catalog is read-only JSON.
8. Only submit or upload after the user explicitly asks. Platform authentication uses the MOOYU.FUN UI/device flow and the host credential store, never a pasted token.

The current read-only catalog is also published at `https://mooyu.fun/downloads/gamehub-creator-tools-v1.json` so an Agent can inspect the latest service metadata. Prefer the signed, installed copy for reproducible work; remote catalog changes do not authorize automatic installation or execution.

## Interactive courseware packages

When the user asks for an interactive lesson, animated explainer, learning simulation, or step-by-step educational tool:

0. Read `<plugin-root>/host-support.json` before claiming native host support. `implemented-unverified` is not a completed compatibility test. Harness currently uses the hosted UI and Agent CLI fallback; its right sidebar must not claim direct local-workspace access.

1. Run `node <plugin-root>/bin/creator-toolkit.mjs init <concept-explorer|causal-simulation|algorithm-stepper> <new-directory>` to copy the closest reference into a user-selected workspace. The command refuses to overwrite an existing directory.
2. Keep `mooyu-courseware.json`, `courseware/course.json`, `evidence/sources.json`, `tests/journeys.json`, and `dist/index.html` consistent. The JSON Schemas under `<plugin-root>/contracts/courseware` are normative.
3. Every learning objective must be covered by a scene and assessed by a checkpoint. Every factual scene claim must resolve to an evidence claim and source. Include at least one journey that reaches course completion.
4. Prefer deterministic, manipulable visuals over decorative animation. Provide text fallbacks and never present generated explanations as verified evidence without a source record.
5. Use `inspect` for a compact machine-readable inventory and `doctor` for contract, reference, secret, path, and static runtime checks. Fix every error and explain warnings.
6. Use `preview <directory>` for a loopback-only, no-store local server. It never binds a public interface.
7. Use `test <directory> --browser-module <existing-playwright-module>` for real journey execution. If Playwright is missing, report the explicit failure and ask before installing it; never download a browser or dependency silently.
8. Use `build <directory>` to create a digest-addressed managed build, then `package <directory>` to create a deterministic ZIP. Both stop when Doctor fails and refuse unsafe overwrites.
9. Emit only the frozen `mooyu.learning.v1` messages from the static runtime. Do not invent privileged host APIs, place model credentials in the package, or call an external model at learner runtime unless a future platform capability explicitly authorizes it.
10. Only after the user explicitly asks to submit, run `node <plugin-root>/bin/creator-submit.mjs submit <absolute-courseware-directory>`. This uploads a private, disabled Release for platform validation and never publishes it.
11. Use `node <plugin-root>/bin/creator-submit.mjs status <absolute-courseware-directory>` to inspect validation. A successful status is evidence that the private Release is ready; it is not permission to publish.
12. Run `node <plugin-root>/bin/creator-submit.mjs publish <absolute-courseware-directory>` only after a separate, direct human request to make that exact validated Release public. Do not infer publication permission from an earlier request to create, test, package, submit, or check status.

## Structured creator packages

When the user asks to create or update a Bingo package from this Agent:

1. Resolve the plugin root relative to this file (`../..`). Copy `templates/creator-bingo` from that root into a user-selected workspace directory; never edit the installed template in place.
2. Edit only the copied `creator-manifest.json` and `source/bingo.json`. Do not generate arbitrary HTML or put credentials in the package.
3. Run `node <plugin-root>/bin/creator-submit.mjs <absolute-package-directory>` only after the user asks to submit or publish.
4. If the command prints a GitHub device URL and code, show both to the user and wait for authorization. Never ask the user to paste a token.
5. Report the returned draft URL. Submission creates or updates a private draft; it does not publicly publish it.

The publisher stores MOOYU.FUN access and refresh tokens only through Git Credential Manager. The package-local `.gamehub/draft.json` contains only the platform origin, draft ID, revision and content digest. A revision conflict must be resolved by the user; do not delete the state file or force an overwrite.
