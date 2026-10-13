BEGIN;

UPDATE author_outreach_records
SET draft_subject = regexp_replace(
      replace(draft_subject,
        'GameHub invitation / GameHub 认领邀请',
        'MOOYU.FUN invitation / 墨鱼工坊认领邀请'),
      'gamehub',
      'MOOYU.FUN',
      'gi'),
    draft_body = regexp_replace(
      replace(
        replace(
          replace(draft_body,
            '我们是 GameHub',
            '我们是墨鱼工坊（MOOYU.FUN）'),
          '在 GameHub',
          '在墨鱼工坊（MOOYU.FUN）'),
        'GameHub 上',
        '墨鱼工坊（MOOYU.FUN）上'),
      'gamehub',
      'MOOYU.FUN',
      'gi'),
    draft_template_version = GREATEST(draft_template_version, 3),
    version = version + 1,
    updated_at = now()
WHERE draft_subject ~* 'gamehub'
   OR draft_body ~* 'gamehub';

COMMIT;
