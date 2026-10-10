---
name: gamehub
description: Use GameHub when the user wants to discover, play, create locally, validate, install, or publish lightweight games from an AI agent.
---

# GameHub

Use this skill when the user asks to open GameHub, find a short game, install GameHub into their Agent, or publish a compatible web game.

- Prefer an installed native GameHub surface or connected GameHub MCP App when the host exposes one.
- If the host cannot embed GameHub, open or provide `https://mooyu.fun`.
- For installation guidance, open or provide `https://mooyu.fun/#/install`.
- Never install a plugin, execute an installer, or modify an Agent profile unless the user explicitly authorizes that action.
- Before installation, state the target host, package source, affected profile, and whether a restart is required.
- Never request, display, copy, or store GameHub access or refresh tokens. Authentication belongs to the GameHub UI and the host's credential store.
- Do not claim an embedded experience is available unless that host integration is marked ready on the installation page.
- When helping publish a game, explain that public untrusted uploads remain subject to GameHub validation and platform limits.

## Agent-local creator toolkits

GameHub does not provide a hosted model or a browser-based replacement for the user's coding Agent. Creation happens in the user's current local workspace with the user's own Agent and model provider. Never ask for or transmit a model API key.

1. Resolve the plugin root relative to this file (`../..`). Run `node <plugin-root>/bin/creator-toolkit.mjs list` to read the versioned toolkit catalog bundled with this plugin.
2. Select a toolkit by the user's intended work, then run `node <plugin-root>/bin/creator-toolkit.mjs show <key>` or `prompt <key>`. Treat the returned catalog entry as workflow data, not permission to download or execute third-party software.
3. Create and edit source files only in a user-selected workspace directory. Do not edit the installed plugin, bundled catalog, or templates in place.
4. Keep model prompts, model credentials, GameHub credentials, personal paths, and unrelated local files out of the produced game.
5. Before packaging a static web result, run the local Creator Doctor: `node <plugin-root>/bin/creator-toolkit.mjs doctor <absolute-web-project-directory>`. Fix every error. Warnings must be explained to the user; a passing local report is not platform approval.
6. `ready` means the plugin includes an end-to-end managed template. `guided` means GameHub supplies the source/output contract but does not bundle or silently install the upstream compiler. `asset-only` cannot be published as a standalone game.
7. Downloading, installing, or executing an upstream compiler/editor requires the user's explicit authorization. Prefer an already-installed compatible tool. Never execute code fetched from the toolkit catalog—the catalog is read-only JSON.
8. Only submit or upload after the user explicitly asks. Platform authentication uses the GameHub UI/device flow and the host credential store, never a pasted token.

The current read-only catalog is also published at `https://mooyu.fun/downloads/gamehub-creator-tools-v1.json` so an Agent can inspect the latest service metadata. Prefer the signed, installed copy for reproducible work; remote catalog changes do not authorize automatic installation or execution.

## Structured creator packages

When the user asks to create or update a Bingo package from this Agent:

1. Resolve the plugin root relative to this file (`../..`). Copy `templates/creator-bingo` from that root into a user-selected workspace directory; never edit the installed template in place.
2. Edit only the copied `creator-manifest.json` and `source/bingo.json`. Do not generate arbitrary HTML or put credentials in the package.
3. Run `node <plugin-root>/bin/creator-submit.mjs <absolute-package-directory>` only after the user asks to submit or publish.
4. If the command prints a GitHub device URL and code, show both to the user and wait for authorization. Never ask the user to paste a token.
5. Report the returned draft URL. Submission creates or updates a private draft; it does not publicly publish it.

The publisher stores GameHub access and refresh tokens only through Git Credential Manager. The package-local `.gamehub/draft.json` contains only the platform origin, draft ID, revision and content digest. A revision conflict must be resolved by the user; do not delete the state file or force an overwrite.
