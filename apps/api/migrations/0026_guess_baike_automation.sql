BEGIN;

ALTER TABLE guess_baike_schedule
  ADD COLUMN origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','automatic'));

CREATE TABLE guess_baike_automation_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  fetched_count integer NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  scheduled_count integer NOT NULL DEFAULT 0 CHECK (scheduled_count >= 0),
  error_code text,
  error_message text
);
CREATE INDEX guess_baike_automation_runs_started_idx ON guess_baike_automation_runs(started_at DESC);

COMMIT;
