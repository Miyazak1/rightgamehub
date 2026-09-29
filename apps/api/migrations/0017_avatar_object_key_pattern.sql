BEGIN;

ALTER TABLE user_avatars DROP CONSTRAINT user_avatars_object_keys_valid;
ALTER TABLE user_avatars ADD CONSTRAINT user_avatars_object_keys_valid CHECK (
  (body_key IS NULL OR body_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}-animated[.]webp$')
  AND (poster_key IS NULL OR poster_key ~ '^avatars/[0-9a-f-]{36}/[0-9a-f]{64}-static[.]webp$')
);

COMMIT;
