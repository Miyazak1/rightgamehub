BEGIN;
-- The trusted plugin registry owns task kinds. Existing immutable identities,
-- input hashes, histories and published workflow versions are unchanged.
ALTER TABLE agent_interactions DROP CONSTRAINT agent_interactions_kind_check;
ALTER TABLE agent_interactions ADD CONSTRAINT agent_interactions_kind_check
 CHECK(kind ~ '^[a-z][a-z0-9_-]{1,79}$');
COMMIT;
