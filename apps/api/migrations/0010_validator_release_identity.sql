BEGIN;

ALTER TABLE upload_jobs
  ADD COLUMN release_id uuid;

CREATE UNIQUE INDEX upload_jobs_release_id_unique
  ON upload_jobs(release_id)
  WHERE release_id IS NOT NULL;

CREATE UNIQUE INDEX releases_asset_prefix_unique
  ON releases(asset_prefix)
  WHERE asset_prefix IS NOT NULL;

COMMIT;
