# Agent account foundation

## Boundaries

This local foundation extends the sealed QA ledger base eed62edb. It creates no online account, registers no management route, enables no provider and does not publish content.

Human users remain the authenticated requester, article permission holder and payer. An Agent is a real users row with account_type=agent and mandatory public badge/operator disclosure. An execution principal belongs to exactly one Agent and grants only research:qa; it is not a human session or payer. Agent accounts cannot receive interactive auth identities or device grants, modify ordinary profile/social settings, or publish.

## Internal operations and credentials

The service requires a trusted authorizeOperator callback, followed by an active human admin check in PostgreSQL. The callback must derive identity from server-controlled authentication, never caller-supplied role flags. Provision, suspend, rotate and revoke are internal service ports, with no HTTP registration or runtime auto-provisioning.

A trusted operator generates a fresh random secret with at least 256 bits of entropy for each rotation and supplies only its SHA-256 verifier. The database stores a unique 32-byte hash; plaintext is never stored or returned. Authentication hashes transient input and returns an agent_execution identity without an ordinary userId. Provision and rotation have exact-input idempotency keys; rotation/suspension lock the Agent and revoke old principals atomically. Revocation does not reactivate credentials.

## QA identity and accounting

In real identity mode, the frozen wire agentAccountId is the real Agent user UUID; executionPrincipalId identifies its principal. Both are persisted with composite foreign keys and immutable binding checks. Admission, delivery claim, action authorization and permit consumption recheck active human permission, Agent status and principal ownership/capability. Human subject, grant and billing fields remain independent.

Legacy simulation requires explicit legacySimulationIdentity=true and cannot be combined with real identity mode. Historical rows with null Agent columns are not silently promoted into real mode. Existing simulation fixtures and protocol hashes remain unchanged.

Already incurred usage may settle after permission or principal revocation: revocation blocks new execution, not truthful historical accounting. Unknown or interrupted deliveries retain their reservations until authenticated status and closure evidence allow release; no automatic resend is added. Duplicate accounting remains idempotent in the existing ledger.

## Migration and integration

0116_agent_accounts.sql follows the deployed change-radar 0114 migration and the integrated QA ledger 0115 migration. Existing migration contents/checksums and frozen protocol/fixtures remain unchanged.

Public profiles add accountType and agentDisclosure; human responses remain compatible. The shared UI displays the Agent badge/operator and wraps long labels on mobile.

## Verified and still gated

The disposable PostgreSQL runner applies all 116 migrations, tests repeated migration, concurrent reservations/provision/rotation, revocation, replay, settlement and interrupted recovery. It uses isolated random databases and simulated execution; no old experiment database or provider credentials are read.

Production wiring remains gated: trusted operator authentication, principal/key registry and historical key routing, current article ACL ports, actual executor integration and deployment configuration are owned by the platform integration step. This foundation is not a public Agent management API or a production deployment.

## Local validation record

- Disposable PostgreSQL 17 migration, ledger and local HTTP suite: 75/75 passed, no skips; container removed.
- Agent service/public disclosure and shared component SSR tests: 5/5 passed.
- App JSX transformation and modified/new backend JavaScript syntax checks passed.
- Full platform suite: 451 passed, 28 skipped, 3 failed (482 total). The unchanged courseware-ui-kit tests have two canonical-byte failures; knowledge-map has one stale review-packet failure. These pre-existing unrelated failures are not counted as passed.
- Sealed QA migration 0113/0114, protocol and fixture files: 10 files byte-identical; no staged differences.
- No provider calls, online accounts, old-task changes, public execution or publishing.
