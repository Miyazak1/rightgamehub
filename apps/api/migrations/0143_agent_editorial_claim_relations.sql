BEGIN;

CREATE TABLE agent_editorial_claim_relations (
  id uuid PRIMARY KEY,
  agent_user_id uuid NOT NULL REFERENCES agent_accounts(user_id) ON DELETE RESTRICT,
  claim_event_id uuid NOT NULL REFERENCES agent_editorial_memory_events(id) ON DELETE RESTRICT,
  relation_kind text NOT NULL CHECK (relation_kind IN ('supports','opposes','context','unknown','revises')),
  evidence_id uuid REFERENCES tool_research_evidence(id) ON DELETE RESTRICT,
  related_claim_event_id uuid REFERENCES agent_editorial_memory_events(id) ON DELETE RESTRICT,
  explanation text NOT NULL CHECK (char_length(explanation) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (related_claim_event_id IS NULL OR related_claim_event_id<>claim_event_id),
  CHECK (
    (relation_kind IN ('supports','opposes','context')
      AND evidence_id IS NOT NULL AND related_claim_event_id IS NULL)
    OR (relation_kind='unknown' AND evidence_id IS NULL AND related_claim_event_id IS NULL)
    OR (relation_kind='revises' AND related_claim_event_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX agent_editorial_claim_evidence_relation_unique
  ON agent_editorial_claim_relations(claim_event_id,relation_kind,evidence_id)
  WHERE evidence_id IS NOT NULL AND related_claim_event_id IS NULL;

CREATE UNIQUE INDEX agent_editorial_claim_event_relation_unique
  ON agent_editorial_claim_relations(claim_event_id,relation_kind,related_claim_event_id)
  WHERE related_claim_event_id IS NOT NULL;

CREATE UNIQUE INDEX agent_editorial_claim_unknown_unique
  ON agent_editorial_claim_relations(claim_event_id)
  WHERE relation_kind='unknown';

CREATE INDEX agent_editorial_claim_relations_agent
  ON agent_editorial_claim_relations(agent_user_id,created_at DESC,id DESC);

CREATE FUNCTION guard_agent_editorial_claim_relations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Agent editorial claim relations are immutable';
END;
$$;

CREATE TRIGGER agent_editorial_claim_relations_immutable
  BEFORE UPDATE OR DELETE ON agent_editorial_claim_relations
  FOR EACH ROW EXECUTE FUNCTION guard_agent_editorial_claim_relations();

COMMIT;
