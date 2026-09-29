BEGIN;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  can_publish boolean NOT NULL DEFAULT false,
  terms_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('email', 'github')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 320),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

COMMIT;
