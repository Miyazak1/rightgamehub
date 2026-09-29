BEGIN;

ALTER TABLE user_avatars
  ADD COLUMN poster_media_type text CHECK (poster_media_type IN ('image/webp')),
  ADD COLUMN poster_body bytea,
  ADD COLUMN poster_sha256 bytea CHECK (poster_sha256 IS NULL OR octet_length(poster_sha256) = 32),
  ADD COLUMN width integer CHECK (width IS NULL OR width BETWEEN 1 AND 512),
  ADD COLUMN height integer CHECK (height IS NULL OR height BETWEEN 1 AND 512),
  ADD COLUMN frame_count integer CHECK (frame_count IS NULL OR frame_count BETWEEN 1 AND 60),
  ADD COLUMN duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 15000);

ALTER TABLE user_avatars ADD CONSTRAINT user_avatars_derivatives_consistent CHECK (
  kind='preset'
  OR (
    poster_media_type='image/webp' AND poster_body IS NOT NULL AND poster_sha256 IS NOT NULL
    AND width IS NOT NULL AND height IS NOT NULL AND frame_count IS NOT NULL AND duration_ms IS NOT NULL
  )
  OR poster_body IS NULL
);

COMMIT;
