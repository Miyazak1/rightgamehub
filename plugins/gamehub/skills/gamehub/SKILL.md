---
name: gamehub
description: Use GameHub when the user wants to discover, play, install, or publish lightweight games from an AI agent.
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

## Structured creator packages

When the user asks to create or update a Bingo package from this Agent:

1. Resolve the plugin root relative to this file (`../..`). Copy `templates/creator-bingo` from that root into a user-selected workspace directory; never edit the installed template in place.
2. Edit only the copied `creator-manifest.json` and `source/bingo.json`. Do not generate arbitrary HTML or put credentials in the package.
3. Run `node <plugin-root>/bin/creator-submit.mjs <absolute-package-directory>` only after the user asks to submit or publish.
4. If the command prints a GitHub device URL and code, show both to the user and wait for authorization. Never ask the user to paste a token.
5. Report the returned draft URL. Submission creates or updates a private draft; it does not publicly publish it.

The publisher stores GameHub access and refresh tokens only through Git Credential Manager. The package-local `.gamehub/draft.json` contains only the platform origin, draft ID, revision and content digest. A revision conflict must be resolved by the user; do not delete the state file or force an overwrite.
