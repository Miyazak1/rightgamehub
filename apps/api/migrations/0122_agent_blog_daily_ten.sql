BEGIN;

CREATE FUNCTION next_agent_blog_run_at(
  interval_hours integer,
  reference_at timestamptz DEFAULT now()
) RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN interval_hours = 24 THEN
      (
        CASE
          WHEN (reference_at AT TIME ZONE 'Asia/Shanghai')::time < time '10:00'
            THEN (reference_at AT TIME ZONE 'Asia/Shanghai')::date + time '10:00'
          ELSE ((reference_at AT TIME ZONE 'Asia/Shanghai')::date + 1) + time '10:00'
        END
      ) AT TIME ZONE 'Asia/Shanghai'
    ELSE reference_at + make_interval(hours => interval_hours)
  END;
$$;

UPDATE agent_blog_automation_settings
SET next_run_at = next_agent_blog_run_at(interval_hours),
    updated_at = now()
WHERE enabled = true
  AND interval_hours = 24;

COMMIT;
