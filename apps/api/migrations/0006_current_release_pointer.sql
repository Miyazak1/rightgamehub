BEGIN;

ALTER TABLE work_targets
  ADD CONSTRAINT work_targets_current_release_fk
  FOREIGN KEY (work_id, target_key, current_release_id)
  REFERENCES releases(work_id, target_key, id)
  ON DELETE RESTRICT;

COMMIT;
