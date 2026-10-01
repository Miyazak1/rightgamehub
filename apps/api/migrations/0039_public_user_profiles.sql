BEGIN;

ALTER TABLE users
  ADD COLUMN profile_handle text,
  ADD COLUMN profile_about text NOT NULL DEFAULT '' CHECK (char_length(profile_about) <= 2000);

UPDATE users
   SET profile_handle = 'u-' || substr(replace(id::text, '-', ''), 1, 30)
 WHERE profile_handle IS NULL;

ALTER TABLE users
  ALTER COLUMN profile_handle SET NOT NULL,
  ALTER COLUMN profile_handle SET DEFAULT ('u-' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
  ADD CONSTRAINT users_profile_handle_check CHECK (profile_handle ~ '^[a-z][a-z0-9-]{2,31}$');

CREATE UNIQUE INDEX users_profile_handle_unique_idx ON users(lower(profile_handle));

CREATE TABLE user_profile_links (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('github','website','portfolio','bilibili','other')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, position),
  UNIQUE (user_id, url)
);

CREATE INDEX user_profile_links_user_idx ON user_profile_links(user_id, position);

CREATE TABLE user_featured_works (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_id),
  UNIQUE (user_id, position)
);

CREATE INDEX user_featured_works_user_idx ON user_featured_works(user_id, position);

COMMIT;
