> This file preserves the upstream Moodlelike integration notes. For the Mooyu host, use `npm run practice:setup`, `npm run practice:test:engine` and [the Right integration guide](../../docs/learning-practice-port.zh-CN.md). The original Agent, Prisma and source-site deployment commands below are not used by Right.

# Verified mathematics in student practice

This adapter uses the frozen Math Lab **engine** as a server-side question supplier
for Moodlelike's existing Agent practice. There is no separate Lab website,
administrator preview workspace, Lab account or Lab database in this integration.

The checked-in archive is `artifacts/math-lab/csca-math-lab-1.43.0.zip`, SHA-256
`10b51845d51093711050d3fbd290ca73e78b6a094d0e8bd74fab1096df0fd3a2`.
`install.cjs` checks the archive, extracts it under ignored `.local/`, checks the
pinned release manifest and all 1,152 listed files, and installs its locked
dependencies. Runtime and adapter code do not require another repository.

Run `npm --prefix question-engine run math:setup` for installation. `npm run local:start` includes
this setup and enables `MOODLELIKE_MATH_ENGINE_ENABLED=true` locally. Apply the
project migrations before using the supplier; migration 0100 gives each host
topic/scope/mathematical identity a unique database key. Outside the local runner
the feature is off unless explicitly configured with all three settings:
`QUESTION_ENGINE_PLUGIN_ENABLED=true`, `QUESTION_ENGINE_PLUGIN_ID=verified-math-1.43`,
and `MOODLELIKE_MATH_ENGINE_ENABLED=true`. Migration 0101 persists generation tasks.

Students use `/agent`, choose math, a knowledge point and basic/medium/hard (or
adaptive difficulty), and start the existing free-practice task. The request goes
through AgentPracticeActionService -> CscaAdaptiveService ->
VerifiedQuestionSupplyService -> sole registered VerifiedMath143Adapter -> frozen
production entry -> beforeStore -> VerifiedQuestionPublicationService -> published
bank reread. The v2 supply demand retains topic, difficulty, source policy and user.
Durable generation tasks have idempotency keys, CAS leases, bounded retries and
private progress; students can read only their own public task status. A generated
question must pass the mathematical/Oracle/teaching/source-artifact checks, then
host history checks, the common candidate write gate and atomic publication before being put into an ordinary
practice round. The source topic's code binds to the host's published topic;
numeric IDs from the frozen engine are preserved as provenance, never reused as
host foreign keys. Unsupported topics and a disabled supplier retain the normal
bank route. An enabled supported supplier that cannot qualify enough questions
returns a recoverable shortage; it never serves rejected output.

Workers are isolated processes with a bounded queue, timeout, memory limit, no
host Provider/database credentials and disabled outbound HTTP transports. Provider
production flags remain off. Mathematical facts, native source, hints, identity
and source admission are retained privately in question metadata. The public
round response uses its existing whitelist and omits answer/solution before an
attempt, including localized solutions. Check/submit use persisted answer keys;
existing exposure, mastery and learning evidence continue to apply. This machine
qualification does not grant independent-intervention-measurement eligibility or
claim empirical difficulty calibration. See `contracts/verified-math-practice.v1.json`.

The legacy four planner difficulty levels map basic -> basic, medium -> medium,
and both harder/challenge -> hard. An explicit student choice overrides that
mapping for ordinary practice. A new user's explicit generated free practice is
not converted into a diagnostic round; diagnostic and post-intervention
verification continue to use their original source rules.

Validation:

* `npm --prefix question-engine run math:test`: frozen engine/inventory gates, 36 cells/141 scopes,
  exact cone answer, source/hint tampering and Oracle rejection, three difficulty
  levels, and answer-free presentation.
* After `npm run backend:build`, set `MATH_ENGINE_ACCEPTANCE_DATABASE_URL` to a
  migrated loopback database named `moodlelike_math_engine_acceptance`, then run
  `node backend/scripts/math-engine-student-live-test.cjs --browser`. This creates
  test students and questions only in that isolated database, exercises the real
  student API and UI, bilingual refresh, idempotent start/submit, answer feedback,
  learning evidence and exclusion from independent measurement. It never loads
  the repository environment file. The screenshot is kept under ignored
  `.local/math-engine/`.

The returned source `eligible_before_history` decision remains intact. Host
ordinary-practice qualification is separate and records what was actually
checked: current generated mathematical-identity history and exact prompt history.
This does not claim semantic deduplication against every legacy imported question.

Legacy Provider generation, review, topic mapping, sidecar execution and production
schedulers are retired even if old flags remain set. Their generation/approval HTTP
routes return 410. Read/answer flows and the three existing banks remain available.
Archived method/UI snapshots are under `legacy/question-production/`; experimental
algorithms are not registered as formal engines. No production or test-site changes
are part of this local integration.
