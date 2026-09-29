BEGIN;

CREATE TABLE creator_usage (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  work_count integer NOT NULL DEFAULT 0 CHECK (work_count >= 0),
  stored_bytes bigint NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  active_uploads integer NOT NULL DEFAULT 0 CHECK (active_uploads >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE works (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
  kind text NOT NULL CHECK (kind IN ('game', 'creative', 'tool')),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'withdrawn', 'suspended')),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  first_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX works_owner_created_idx ON works(owner_user_id, created_at DESC);

COMMIT;
