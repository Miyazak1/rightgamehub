BEGIN;

ALTER TABLE guess_baike_puzzles
  DROP CONSTRAINT guess_baike_puzzles_status_check,
  ADD CONSTRAINT guess_baike_puzzles_status_check CHECK (status IN ('ready','disabled','rejected')),
  ADD COLUMN selection_signals jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(selection_signals)='object');

COMMIT;
