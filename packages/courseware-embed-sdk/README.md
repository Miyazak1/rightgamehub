# `@mooyu/courseware-embed-sdk`

Reference implementations for frozen `mooyu.courseware.embed.v1` and additive `mooyu.courseware.embed.v2`.

- `src/protocol.mjs` freezes strict envelopes, names, byte limits and exact-origin checks.
- `src/index.mjs` is the dependency-free external host reference using `MessageChannel` and a nonce-bound handshake.
- `src/gateway.mjs` is the reference boundary that converts existing `mooyu.learning.v1` messages into minimized external events.
- `src/policy.mjs` proves fixed/current Release, revocation and parent-origin decisions fail closed.
- `src/protocol-v2.mjs`, `src/index-v2.mjs` and `src/gateway-v2.mjs` add bounded state snapshot export/restore and host-controlled experience modes without changing v1 envelopes.

This package is not yet the production `embed.mooyu.fun` service. Run `npm run start:courseware-embed-acceptance` from the repository root for the two-origin reference pages. Production gateway work starts in E1 only after the E0 manual browser matrix is recorded.
