BEGIN;

ALTER TABLE users
  ADD COLUMN profile_library_visibility text NOT NULL DEFAULT 'private'
    CHECK (profile_library_visibility IN ('public','followers','private'));

COMMIT;
