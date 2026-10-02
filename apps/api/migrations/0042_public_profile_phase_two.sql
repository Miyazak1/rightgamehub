BEGIN;

ALTER TABLE users
  ADD COLUMN profile_collaboration_status text NOT NULL DEFAULT 'not_looking'
    CHECK (profile_collaboration_status IN ('not_looking','open_to_collaboration','available_for_hire')),
  ADD COLUMN profile_skills text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(profile_skills) <= 12),
  ADD COLUMN profile_activity_visibility text NOT NULL DEFAULT 'private'
    CHECK (profile_activity_visibility IN ('public','followers','private')),
  ADD COLUMN profile_achievements_visibility text NOT NULL DEFAULT 'followers'
    CHECK (profile_achievements_visibility IN ('public','followers','private'));

COMMIT;
