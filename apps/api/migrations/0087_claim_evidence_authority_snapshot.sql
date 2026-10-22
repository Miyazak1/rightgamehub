BEGIN;

ALTER TABLE tool_research_claim_evidence
  ADD COLUMN evidence_authority_tier text NOT NULL DEFAULT 'unknown'
  CHECK (evidence_authority_tier IN (
    'official-primary',
    'official-implementation',
    'institutional',
    'independent-reputable',
    'community',
    'unknown'
  ));

COMMIT;
