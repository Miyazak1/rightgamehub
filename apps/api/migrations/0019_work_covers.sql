BEGIN;

ALTER TABLE works
  ADD COLUMN cover_object_key text,
  ADD COLUMN cover_sha256 bytea,
  ADD COLUMN cover_media_type text,
  ADD COLUMN cover_byte_length integer,
  ADD COLUMN cover_width integer,
  ADD COLUMN cover_height integer,
  ADD CONSTRAINT works_cover_fields_check CHECK (
    (cover_object_key IS NULL AND cover_sha256 IS NULL AND cover_media_type IS NULL AND cover_byte_length IS NULL AND cover_width IS NULL AND cover_height IS NULL)
    OR
    (cover_object_key ~ '^covers/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$' AND octet_length(cover_sha256)=32 AND cover_media_type='image/webp'
      AND cover_byte_length BETWEEN 1 AND 1048576 AND cover_width=960 AND cover_height=540)
  );

COMMIT;
