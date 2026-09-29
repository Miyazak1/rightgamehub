BEGIN;

ALTER TABLE works
  ADD COLUMN estimated_minutes integer NOT NULL DEFAULT 3 CHECK (estimated_minutes BETWEEN 1 AND 30),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(tags) <= 6),
  ADD COLUMN agent_label text CHECK (agent_label IS NULL OR char_length(agent_label) BETWEEN 1 AND 40),
  ADD COLUMN repository_url text CHECK (repository_url IS NULL OR repository_url ~ '^https://github\.com/[^/[:space:]]+/[^/[:space:]]+/?$'),
  ADD COLUMN license_spdx text CHECK (license_spdx IS NULL OR char_length(license_spdx) BETWEEN 1 AND 40);

ALTER TABLE works
  ADD CONSTRAINT works_open_source_pair_check CHECK (
    (repository_url IS NULL AND license_spdx IS NULL)
    OR (repository_url IS NOT NULL AND license_spdx IS NOT NULL)
  );

CREATE INDEX works_public_discovery_idx
  ON works(first_published_at DESC, id)
  WHERE state='published' AND visibility='public';

COMMIT;
