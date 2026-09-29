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
