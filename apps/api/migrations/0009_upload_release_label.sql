BEGIN;

ALTER TABLE upload_jobs
  ADD COLUMN release_label text NOT NULL DEFAULT 'Initial release';

ALTER TABLE upload_jobs
  ALTER COLUMN release_label DROP DEFAULT;

ALTER TABLE upload_jobs
  ADD CONSTRAINT upload_jobs_release_label_length
  CHECK (char_length(release_label) BETWEEN 1 AND 64);

COMMIT;
