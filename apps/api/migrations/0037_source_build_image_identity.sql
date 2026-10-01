BEGIN;

ALTER TABLE build_jobs DROP CONSTRAINT build_jobs_source_revision_id_config_sha256_key;
ALTER TABLE build_jobs ADD CONSTRAINT build_jobs_revision_config_image_unique
  UNIQUE (source_revision_id, config_sha256, builder_image_digest);

COMMIT;
