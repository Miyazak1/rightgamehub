BEGIN;
ALTER TABLE contribution_tasks
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN claim_expires_at timestamptz,
  ADD COLUMN review_reason text NOT NULL DEFAULT '' CHECK (char_length(review_reason) <= 2000),
  ADD COLUMN resolved_release_id uuid REFERENCES releases(id) ON DELETE RESTRICT;
UPDATE contribution_tasks SET claim_expires_at=now()+interval '7 days' WHERE status='claimed';
CREATE INDEX contribution_tasks_expiry_idx ON contribution_tasks(claim_expires_at) WHERE status='claimed';
CREATE INDEX contribution_events_actor_rate_idx ON contribution_task_events(actor_user_id,created_at DESC);
ALTER TABLE contribution_task_events DROP CONSTRAINT contribution_task_events_action_check;
ALTER TABLE contribution_task_events ADD CHECK (action IN
 ('draft_created','edited','published','claimed','released','submitted','changes_requested','completed','closed','reopened','issue_drafted','issue_linked','renewed','withdrawn','claim_expired','release_linked','work_unavailable'));
CREATE TABLE contribution_task_participants (
 task_id uuid NOT NULL REFERENCES contribution_tasks(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 PRIMARY KEY(task_id,user_id)
);
INSERT INTO contribution_task_participants(task_id,user_id)
 SELECT id,claimant_user_id FROM contribution_tasks WHERE claimant_user_id IS NOT NULL
 UNION SELECT task_id,actor_user_id FROM contribution_task_events WHERE action='claimed';
CREATE INDEX contribution_participants_user_idx ON contribution_task_participants(user_id,task_id);
CREATE TABLE contribution_notifications (
 event_id uuid NOT NULL REFERENCES contribution_task_events(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,user_id)
);
CREATE INDEX contribution_notifications_user_idx ON contribution_notifications(user_id,created_at DESC,event_id DESC);
CREATE INDEX contribution_notifications_unread_idx ON contribution_notifications(user_id) WHERE read_at IS NULL;
CREATE FUNCTION record_contribution_event(eid uuid,tid uuid,actor uuid,kind text,payload jsonb,recipients uuid[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO contribution_task_events(id,task_id,actor_user_id,action,details) VALUES(eid,tid,actor,kind,payload);
 INSERT INTO contribution_notifications(event_id,user_id,read_at)
 SELECT eid,u,CASE WHEN u=actor AND COALESCE(payload->>'automatic','false')<>'true' THEN now() ELSE NULL END FROM
 (SELECT DISTINCT unnest(recipients) AS u) audience WHERE u IS NOT NULL;
END;
$$;
-- Task mutations lock the work before its tasks, matching work withdrawal.
CREATE FUNCTION close_unavailable_contribution_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task contribution_tasks;
BEGIN
 IF NEW.state='published' AND NEW.visibility='public' THEN RETURN NEW; END IF;
 FOR task IN SELECT * FROM contribution_tasks WHERE work_id=NEW.id AND status IN ('draft','open','claimed','submitted') ORDER BY id FOR UPDATE LOOP
  PERFORM record_contribution_event(gen_random_uuid(),task.id,NEW.owner_user_id,'work_unavailable',
   jsonb_build_object('automatic',true,'reason','作品已停止公开，任务已关闭并释放领取名额。','submissionUrl',task.submission_url,'submissionNote',task.submission_note),
   ARRAY[task.author_user_id,task.claimant_user_id]);
  UPDATE contribution_tasks SET status='closed',claimant_user_id=NULL,claimed_at=NULL,claim_expires_at=NULL,
   submission_url=NULL,submission_note='',submitted_at=NULL,closed_at=now(),updated_at=now(),version=version+1,
   review_reason='作品已停止公开，任务已关闭并释放领取名额。' WHERE id=task.id;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER works_close_contribution_tasks AFTER UPDATE OF state,visibility ON works
 FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.visibility IS DISTINCT FROM NEW.visibility)
 EXECUTE FUNCTION close_unavailable_contribution_tasks();
-- Also reconcile tasks hidden before this upgrade.
DO $$
DECLARE task contribution_tasks;
BEGIN
 FOR task IN SELECT t.* FROM contribution_tasks t JOIN works w ON w.id=t.work_id
 WHERE (w.state<>'published' OR w.visibility<>'public') AND t.status IN ('draft','open','claimed','submitted') LOOP
  PERFORM record_contribution_event(gen_random_uuid(),task.id,task.author_user_id,'work_unavailable',
   jsonb_build_object('automatic',true,'reason','作品已停止公开，任务已关闭并释放领取名额。','submissionUrl',task.submission_url,'submissionNote',task.submission_note),
   ARRAY[task.author_user_id,task.claimant_user_id]);
  UPDATE contribution_tasks SET status='closed',claimant_user_id=NULL,claimed_at=NULL,claim_expires_at=NULL,
   submission_url=NULL,submission_note='',submitted_at=NULL,closed_at=now(),updated_at=now(),version=version+1,
   review_reason='作品已停止公开，任务已关闭并释放领取名额。' WHERE id=task.id;
 END LOOP;
END;
$$;
ALTER TABLE creator_feedback DROP CONSTRAINT creator_feedback_status_check;
ALTER TABLE creator_feedback ADD CHECK(status IN ('new','reviewed','archived','issue_drafted','issue_linked','resolved'));
ALTER TABLE creator_feedback_events DROP CONSTRAINT creator_feedback_events_action_check;
ALTER TABLE creator_feedback_events ADD CHECK(action IN ('submitted','reviewed','archived','reopened','issue_drafted','issue_linked','resolved'));
COMMIT;
