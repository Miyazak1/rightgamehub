BEGIN;

ALTER TABLE author_outreach_records
  DROP CONSTRAINT author_outreach_records_status_check,
  ADD CONSTRAINT author_outreach_records_status_check
    CHECK (status IN ('review','ready','opened','contacted','replied','declined','paused'));

ALTER TABLE author_outreach_events
  DROP CONSTRAINT author_outreach_events_action_check,
  ADD CONSTRAINT author_outreach_events_action_check
    CHECK (action IN ('discovered','updated','opened','contacted','replied','declined','paused','reopened'));

COMMIT;
