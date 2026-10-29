BEGIN;

ALTER TABLE agent_editorial_memory_events
  DROP CONSTRAINT agent_editorial_memory_events_event_type_check,
  ADD CONSTRAINT agent_editorial_memory_events_event_type_check CHECK (event_type IN (
    'project-featured','project-compared','project-version-observed','comparison-used',
    'topic-used','claim-stated','scenario-used'
  )),
  ADD COLUMN previous_event_id uuid REFERENCES agent_editorial_memory_events(id) ON DELETE RESTRICT,
  ADD COLUMN research_reason text CHECK (
    research_reason IS NULL OR char_length(research_reason) BETWEEN 3 AND 120
  );

ALTER TABLE agent_editorial_memory_events
  ADD CONSTRAINT agent_editorial_memory_version_event_shape CHECK (
    (event_type='project-version-observed'
      AND subject_kind='project'
      AND research_source_version_id IS NOT NULL
      AND research_reason IS NOT NULL)
    OR
    (event_type<>'project-version-observed'
      AND previous_event_id IS NULL
      AND research_reason IS NULL)
  );

CREATE INDEX agent_editorial_memory_project_versions
  ON agent_editorial_memory_events(
    agent_user_id,subject_key,occurred_at DESC,id DESC
  ) WHERE event_type='project-version-observed';

COMMIT;
