# Trusted multiplayer rules bundles

This directory is mounted read-only into the API and Realtime containers. It is not an upload destination.

When installing a server-authoritative game:

1. Put a single-file CommonJS bundle such as `my-game/duel-1.0.0.cjs` here.
2. Add its `workId`, `modeKey`, `rulesetVersion` and relative `bundle` path to `manifest.json`.
3. Sign and verify the manifest with the offline release key:

   ```bash
   npm run rules:manifest -- sign rules/manifest.json /secure/offline-private-key.pem
   npm run rules:manifest -- verify rules/manifest.json /secure/trusted-public-keys.json
   ```

4. Set `RULES_MANIFEST_PATH=/app/rules/manifest.json` and set `RULES_TRUSTED_KEYS_JSON` to the compact JSON object from the trusted public-key file.
5. Recreate both `api` and `realtime`. Both services must report the same adapter count before a mode is enabled.

Never place the offline private key in this directory, Git, a container image or server environment. Author uploads cannot write here.
