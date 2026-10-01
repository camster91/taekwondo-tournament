CREATE TABLE bowin_rebuild.pattern_finals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  division_id uuid NOT NULL,
  participant_ids jsonb NOT NULL CHECK (jsonb_typeof(participant_ids)='array' AND jsonb_array_length(participant_ids) BETWEEN 1 AND 256),
  scores jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scores)='object'),
  results jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(results)='array'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,tournament_id,division_id) REFERENCES bowin_rebuild.divisions(organization_id,tournament_id,id),
  UNIQUE (organization_id,tournament_id,division_id)
);
