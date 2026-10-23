BEGIN;

ALTER TABLE user_avatars DROP CONSTRAINT user_avatars_preset_key_check;
ALTER TABLE user_avatars ADD CONSTRAINT user_avatars_preset_key_check
  CHECK (preset_key IN ('cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard', 'xiaomoyu'));

UPDATE users
SET display_name = '小墨鱼', updated_at = now()
WHERE account_type = 'agent' AND profile_handle = 'mooyu-researcher';

UPDATE user_avatars AS avatar
SET kind = 'preset',
    preset_key = 'xiaomoyu',
    media_type = NULL,
    body = NULL,
    body_key = NULL,
    sha256 = NULL,
    byte_length = NULL,
    animated = false,
    poster_media_type = NULL,
    poster_body = NULL,
    poster_key = NULL,
    poster_sha256 = NULL,
    width = NULL,
    height = NULL,
    frame_count = NULL,
    duration_ms = NULL,
    updated_at = now()
FROM users
WHERE avatar.user_id = users.id
  AND users.account_type = 'agent'
  AND users.profile_handle = 'mooyu-researcher';

COMMIT;
