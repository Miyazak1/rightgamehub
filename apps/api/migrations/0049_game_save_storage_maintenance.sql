BEGIN;
ALTER TABLE game_save_capacity ADD COLUMN storage_write_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_write_bytes>=0);
-- Count reservations in the payload trigger, including writes from older API processes.
CREATE OR REPLACE FUNCTION count_game_save_payload_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE game_save_capacity SET retained_bytes=retained_bytes+octet_length(NEW.payload_inline),
      storage_write_bytes=storage_write_bytes+octet_length(NEW.payload_inline)::bigint*4+16384
      WHERE singleton AND NOT writes_paused AND retained_bytes+octet_length(NEW.payload_inline)<=max_payload_bytes;
    IF NOT FOUND THEN RAISE EXCEPTION 'save payload capacity closed' USING ERRCODE='P7501'; END IF;
    RETURN NEW;
  END IF;
  UPDATE game_save_capacity SET retained_bytes=retained_bytes-octet_length(OLD.payload_inline) WHERE singleton;
  RETURN OLD;
END;
$$;
CREATE TABLE game_save_storage_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  observed_at timestamptz NOT NULL,
  cluster_id text NOT NULL,
  total_bytes bigint NOT NULL CHECK(total_bytes>0),
  available_bytes bigint NOT NULL CHECK(available_bytes BETWEEN 0 AND total_bytes),
  total_inodes bigint NOT NULL CHECK(total_inodes>0),
  available_inodes bigint NOT NULL CHECK(available_inodes BETWEEN 0 AND total_inodes),
  wal_bytes bigint NOT NULL CHECK(wal_bytes>=0),
  write_baseline bigint NOT NULL CHECK(write_baseline>=0)
);
-- Invoker privileges only. The probe also checks the mounted PGDATA cluster identity.
CREATE FUNCTION record_game_save_storage(sample_time timestamptz,cluster text,total bigint,available bigint,inodes bigint,free_inodes bigint,wal bigint,baseline bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF pg_is_in_recovery() OR cluster<>(SELECT system_identifier::text FROM pg_control_system())
    OR sample_time>clock_timestamp() OR sample_time<clock_timestamp()-interval '15 seconds'
    OR baseline>(SELECT storage_write_bytes FROM game_save_capacity WHERE singleton) THEN
    RAISE EXCEPTION 'invalid save storage sample';
  END IF;
  INSERT INTO game_save_storage_status VALUES(true,sample_time,cluster,total,available,inodes,free_inodes,wal,baseline)
  ON CONFLICT(singleton) DO UPDATE SET observed_at=EXCLUDED.observed_at,cluster_id=EXCLUDED.cluster_id,
    total_bytes=EXCLUDED.total_bytes,available_bytes=EXCLUDED.available_bytes,total_inodes=EXCLUDED.total_inodes,
    available_inodes=EXCLUDED.available_inodes,wal_bytes=EXCLUDED.wal_bytes,write_baseline=EXCLUDED.write_baseline
  WHERE game_save_storage_status.observed_at<EXCLUDED.observed_at;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION record_game_save_storage(timestamptz,text,bigint,bigint,bigint,bigint,bigint,bigint) FROM PUBLIC;
ALTER TABLE game_save_usage ADD COLUMN maintenance_next_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE game_save_usage ADD COLUMN maintenance_last_code text;
CREATE INDEX game_save_usage_maintenance_due ON game_save_usage(maintenance_next_at,user_id,work_id,channel);
CREATE INDEX game_save_usage_maintenance_errors ON game_save_usage(maintenance_last_code) WHERE maintenance_last_code IS NOT NULL;
CREATE TABLE game_save_maintenance_runs (
  id uuid PRIMARY KEY, worker_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id), work_id uuid NOT NULL REFERENCES works(id),
  channel text NOT NULL CHECK(channel IN ('production','preview')),
  status text NOT NULL CHECK(status IN ('ok','error')),
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 80),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX game_save_maintenance_runs_recent ON game_save_maintenance_runs(created_at DESC);
CREATE TRIGGER game_save_maintenance_run_immutable BEFORE UPDATE OR DELETE ON game_save_maintenance_runs
  FOR EACH ROW EXECUTE FUNCTION immutable_game_save_fact();
CREATE TABLE game_save_maintenance_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  last_tick_at timestamptz NOT NULL, last_run_at timestamptz,
  status text NOT NULL CHECK(status IN ('ok','idle','busy','error')),
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 80)
);
COMMIT;
