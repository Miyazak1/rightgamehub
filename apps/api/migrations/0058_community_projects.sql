BEGIN;

CREATE TABLE community_projects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  work_id uuid REFERENCES works(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 240),
  description text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 4000),
  status text NOT NULL DEFAULT 'recruiting' CHECK (status IN ('draft','recruiting','active','completed','archived','cancelled')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX community_projects_public_idx ON community_projects(status,updated_at DESC,id DESC) WHERE visibility='public';
CREATE INDEX community_projects_owner_idx ON community_projects(owner_id,updated_at DESC,id DESC);

CREATE TABLE community_project_roles (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES community_projects(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  capacity smallint NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  required_skills text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(required_skills) <= 8),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 31),
  UNIQUE(project_id,id),
  UNIQUE(project_id,name)
);
CREATE INDEX community_project_roles_project_idx ON community_project_roles(project_id,position,id);

CREATE TABLE community_project_members (
  project_id uuid NOT NULL REFERENCES community_projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id uuid,
  membership_state text NOT NULL DEFAULT 'active' CHECK (membership_state IN ('active','left')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY(project_id,user_id),
  FOREIGN KEY(project_id,role_id) REFERENCES community_project_roles(project_id,id) ON DELETE RESTRICT,
  CHECK ((membership_state='left')=(left_at IS NOT NULL))
);
CREATE INDEX community_project_members_role_idx ON community_project_members(project_id,role_id) WHERE membership_state='active';
CREATE INDEX community_project_members_user_idx ON community_project_members(user_id,project_id) WHERE membership_state='active';

CREATE TABLE community_project_applications (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES community_projects(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,
  applicant_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 1000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','withdrawn')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  FOREIGN KEY(project_id,role_id) REFERENCES community_project_roles(project_id,id) ON DELETE RESTRICT,
  CHECK ((state IN ('approved','rejected'))=(decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX community_project_applications_pending_unique ON community_project_applications(project_id,applicant_id) WHERE state='pending';
CREATE INDEX community_project_applications_owner_idx ON community_project_applications(project_id,state,created_at,id);
CREATE INDEX community_project_applications_user_idx ON community_project_applications(applicant_id,created_at DESC,id DESC);

CREATE TABLE community_project_posts (
  project_id uuid NOT NULL REFERENCES community_projects(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  relation_kind text NOT NULL CHECK (relation_kind IN ('update','announcement')),
  PRIMARY KEY(project_id,post_id),
  UNIQUE(post_id)
);

CREATE TABLE community_project_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES community_projects(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created','updated','application_submitted','application_approved','application_rejected','member_left','task_linked','post_linked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_project_events_project_idx ON community_project_events(project_id,created_at DESC,id DESC);

ALTER TABLE contribution_tasks ADD COLUMN project_id uuid REFERENCES community_projects(id) ON DELETE RESTRICT;
CREATE INDEX contribution_tasks_project_idx ON contribution_tasks(project_id,status,updated_at DESC,id DESC) WHERE project_id IS NOT NULL;

CREATE FUNCTION validate_contribution_project_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project_work uuid;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT work_id INTO project_work FROM community_projects WHERE id=NEW.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'community project not found'; END IF;
  IF project_work IS NOT NULL AND project_work<>NEW.work_id THEN
    RAISE EXCEPTION 'contribution task work must match community project work';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contribution_tasks_project_work_guard BEFORE INSERT OR UPDATE OF project_id,work_id ON contribution_tasks
  FOR EACH ROW EXECUTE FUNCTION validate_contribution_project_work();

CREATE FUNCTION reject_community_project_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'community project events are append-only';
END;
$$;
CREATE TRIGGER community_project_events_no_update BEFORE UPDATE ON community_project_events FOR EACH ROW EXECUTE FUNCTION reject_community_project_event_mutation();
CREATE TRIGGER community_project_events_no_delete BEFORE DELETE ON community_project_events FOR EACH ROW EXECUTE FUNCTION reject_community_project_event_mutation();

COMMIT;
