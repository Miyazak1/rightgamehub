BEGIN;

ALTER TABLE author_outreach_records
  ADD COLUMN draft_template_version integer NOT NULL DEFAULT 1
  CHECK (draft_template_version BETWEEN 1 AND 1000);

COMMIT;
