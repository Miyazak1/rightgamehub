# Trusted multiplayer rules bundles

This directory is mounted read-only into the API and Realtime containers. It is not an upload destination.

When installing a server-authoritative game, create a complete immutable release offline:

1. Stage a release from the new single-file CommonJS bundle and the current signed manifest.
2. Sign and verify it with the offline release key:

   ```bash
   npm run rules:release -- stage ./next-release <key-id> ./bundle.cjs <work-id> <mode-key> <ruleset-version> ./current/manifest.json /secure/trusted-public-keys.json
   npm run rules:release -- sign ./next-release/manifest.unsigned.json /secure/offline-private-key.pem ./next-release/manifest.json
   npm run rules:release -- verify-release ./next-release /secure/trusted-public-keys.json
   ```

3. Set `RULES_MANIFEST_PATH=/app/rules/current/manifest.json` and set `RULES_TRUSTED_KEYS_JSON` to the compact JSON object from the trusted public-key file.
4. Run `deploy/rules-release.sh install ./next-release`. Both services must report the exact same manifest SHA-256 before a mode is enabled. Use `deploy/rules-release.sh rollback` to return to the verified previous release.

Never place the offline private key in this directory, Git, a container image or server environment. Author uploads cannot write here.
