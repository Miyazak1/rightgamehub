BEGIN;

CREATE TABLE user_avatars (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preset', 'upload')),
  preset_key text CHECK (preset_key IN ('cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard')),
  media_type text CHECK (media_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  body bytea,
  sha256 bytea CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
  byte_length integer CHECK (byte_length IS NULL OR byte_length BETWEEN 1 AND 2097152),
  animated boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind='preset' AND preset_key IS NOT NULL AND media_type IS NULL AND body IS NULL AND sha256 IS NULL AND byte_length IS NULL AND animated=false)
    OR
    (kind='upload' AND preset_key IS NULL AND media_type IS NOT NULL AND body IS NOT NULL AND sha256 IS NOT NULL AND byte_length=octet_length(body))
  )
);

INSERT INTO user_avatars(user_id,kind,preset_key)
SELECT id,'preset',(ARRAY['cat','robot','sprout','fox','ghost','wizard'])[1 + get_byte(decode(md5(id::text),'hex'),0) % 6]
FROM users;

COMMIT;
