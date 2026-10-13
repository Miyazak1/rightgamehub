# MOOYU.FUN Agent installation and security

MOOYU.FUN games and the main interface run on MOOYU.FUN servers. Host integrations provide a trusted container for that interface, account credentials, file export, and supported native launches; they do not move game execution into the Agent model process.

## Recommended installation

Open [mooyu.fun/install?lang=en](https://mooyu.fun/install?lang=en), choose the current host, and copy either the official command or the installation prompt. If an Agent performs the installation, it must inspect the official script, explain the planned changes, and wait for explicit approval before running it.

Windows PowerShell example for Cursor:

```powershell
& ([scriptblock]::Create((irm https://mooyu.fun/install.ps1))) -HostName cursor
```

macOS/Linux example for Cursor:

```sh
curl -fsSL https://mooyu.fun/install.sh | sh -s -- cursor
```

Replace `cursor` with `code`, `harness`, `codex`, or `claude` for another supported host.

## What the installer does

1. Downloads the production artifact manifest from `https://mooyu.fun`.
2. Downloads only the artifact required for the selected host.
3. Verifies the published SHA-256 digest before installation.
4. Calls the host’s official extension or plugin command.
5. Enables the supported automatic-update mechanism for the current user.

The installer does not clone the source repository, read the current project, or request a model-provider key.

## Credentials and isolation

- Login tokens are stored through the host’s secure credential mechanism when one is available.
- Game iframes cannot access host credentials or unrelated project files.
- Web games run on isolated release origins with a restricted capability bridge.
- Native Windows packages are downloaded and verified before launch; only run works you trust.
- MOOYU.FUN authentication happens in the platform UI. Never paste an access or refresh token into an Agent prompt.

## Updates

VS Code and Cursor stage verified extension updates in the background. Other supported Agents use a current-user scheduled task or cron job. A staged update activates after the relevant host restarts. The hosted platform and MCP App interface update with normal MOOYU.FUN deployments and do not require reinstalling the local shell for ordinary UI changes.
