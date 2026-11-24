BEGIN;
ALTER TABLE agent_interactions DROP CONSTRAINT agent_interactions_kind_check;
ALTER TABLE agent_interactions ADD CONSTRAINT agent_interactions_kind_check
 CHECK(kind IN ('message','github-search','github-article','github-question'));
COMMIT;
