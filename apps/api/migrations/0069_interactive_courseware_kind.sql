BEGIN;

ALTER TABLE works DROP CONSTRAINT works_kind_check;
ALTER TABLE works ADD CONSTRAINT works_kind_check CHECK (kind IN ('game', 'creative', 'tool', 'courseware'));

COMMIT;
