# MOOYU.FUN (Mooyu Workshop)

[简体中文](README.md)

Open and play. Create together.

MOOYU.FUN is a platform for lightweight games and interactive works, built for players and creators. The production site is [mooyu.fun](https://mooyu.fun). The current deployment baseline is suitable for a single-host, invitation-only preview; it is not yet a production baseline for unrestricted anonymous publishing.

Public surfaces use the MOOYU.FUN / Mooyu Workshop brand. Internal identifiers such as `gamehub`, API headers, and local data folders remain unchanged for compatibility.

## Use MOOYU.FUN in an Agent

The production install page is [mooyu.fun/install](https://mooyu.fun/install). Integrations embed the full hosted interface when the host can do so safely and fall back to the browser otherwise.

| Host | Integration | Install |
| --- | --- | --- |
| DeepSeek Harness | Native right panel | Windows: run `install.ps1` with `-HostName harness`; macOS/Linux: `curl -fsSL https://mooyu.fun/install.sh \| sh -s -- harness` |
| VS Code | Native sidebar | Windows: run `install.ps1` with `-HostName code`; macOS/Linux: `curl -fsSL https://mooyu.fun/install.sh \| sh -s -- code` |
| Cursor | Native sidebar | Windows: run `install.ps1` with `-HostName cursor`; macOS/Linux: `curl -fsSL https://mooyu.fun/install.sh \| sh -s -- cursor` |
| Codex / ChatGPT | Plugin + hosted MCP App | Windows: run `install.ps1` with `-HostName codex`; macOS/Linux: `curl -fsSL https://mooyu.fun/install.sh \| sh -s -- codex`, then install `gamehub` from the MOOYU.FUN Plugins source |
| Claude Code | Portable Agent plugin | Windows: run `install.ps1` with `-HostName claude`; macOS/Linux: `curl -fsSL https://mooyu.fun/install.sh \| sh -s -- claude` |

The installers do not clone this repository. They download built artifacts and a version manifest from `https://mooyu.fun`, verify SHA-256 digests, and then call the host’s official extension or plugin command. The user must approve installation before an Agent runs it.

See the [Agent installation and security guide](docs/agent-installation.en.md) for details.

## Player and creator flows

- Anyone can browse and play public browser games without creating an account.
- An account is required for library sync, community participation, and creator workflows.
- Creators can upload a Web ZIP or import a GitHub repository through the creator workspace.
- Imported or uploaded works retain source, license, attribution, claim, and remix provenance where available.
- Untrusted public uploads remain subject to validation and platform limits.

The web client supports Simplified Chinese and English. User-authored titles, descriptions, posts, and game content remain in their original language. The administrator and moderation workspace intentionally remains Chinese for the current operating team.

## Development

Requirements: Node.js and the workspace package manager declared in `package.json`.

```powershell
npm install
npm run web:build
npm test
```

Useful commands:

- `npm run web:dev` — start the web client in development mode.
- `npm run api:start` — start the API service.
- `npm run contracts:check` — verify generated API contracts.
- `npm run pack:vscode` — build and package the VS Code/Cursor extension.
- `npm run build:agent-plugin` — build the portable Agent plugin.

Architecture and operations documents are currently maintained primarily in Chinese under [`docs/`](docs/README.md). English public documentation will expand with the product surface; internal deployment and moderation runbooks remain Chinese.
