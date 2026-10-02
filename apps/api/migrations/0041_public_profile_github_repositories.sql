BEGIN;

CREATE TABLE user_profile_github_repositories (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_repository_id uuid NOT NULL REFERENCES github_source_repositories(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_repository_id),
  UNIQUE (user_id, position)
);

CREATE INDEX user_profile_github_repositories_user_idx
  ON user_profile_github_repositories(user_id, position);

COMMIT;
