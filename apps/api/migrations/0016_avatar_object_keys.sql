BEGIN;

ALTER TABLE user_avatars
  ADD COLUMN body_key text,
  ADD COLUMN poster_key text;

ALTER TABLE user_avatars DROP CONSTRAINT user_avatars_check;
ALTER TABLE user_avatars DROP CONSTRAINT user_avatars_derivatives_consistent;

ALTER TABLE user_avatars ADD CONSTRAINT user_avatars_payload_consistent CHECK (
  (kind='preset' AND preset_key IS NOT NULL AND media_type IS NULL AND body IS NULL AND body_key IS NULL AND sha256 IS NULL AND byte_length IS NULL AND animated=false)
  OR
  (kind='upload' AND preset_key IS NULL AND media_type IS NOT NULL AND sha256 IS NOT NULL AND byte_length IS NOT NULL
    AND ((body IS NOT NULL AND body_key IS NULL AND byte_length=octet_length(body)) OR (body IS NULL AND body_key IS NOT NULL)))
);

ALTER TABLE user_avatars ADD CONSTRAINT user_avatars_derivatives_consistent CHECK (
  kind='preset'
  OR (
    poster_media_type='image/webp' AND poster_sha256 IS NOT NULL
    AND ((poster_body IS NOT NULL AND poster_key IS NULL) OR (poster_body IS NULL AND poster_key IS NOT NULL))
    AND width IS NOT NULL AND height IS NOT NULL AND frame_count IS NOT NULL AND duration_ms IS NOT NULL
  )
  OR (poster_body IS NULL AND poster_key IS NULL)
);

ALTER TABLE user_avatars ADD CONSTRAINT user_avatars_object_keys_valid CHECK (
  (body_key IS NULL OR body_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}-animated\\.webp$')
  AND (poster_key IS NULL OR poster_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}-static\\.webp$')
);

COMMIT;
