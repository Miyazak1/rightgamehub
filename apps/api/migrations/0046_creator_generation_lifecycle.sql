BEGIN;

ALTER TABLE creator_generation_jobs
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'bingo-structured-v1',
  ADD COLUMN model text NOT NULL DEFAULT 'structured-template-v1',
  ADD COLUMN applied_revision bigint CHECK (applied_revision IS NULL OR applied_revision >= 1);

CREATE UNIQUE INDEX creator_generation_jobs_one_active_per_draft_idx
  ON creator_generation_jobs(draft_id)
  WHERE state IN ('queued','running');

COMMIT;
