ALTER TABLE bowin_rebuild.audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE bowin_rebuild.brackets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  division_id uuid NOT NULL,
  matches jsonb NOT NULL CHECK(jsonb_typeof(matches)='array'),
  champion_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,tournament_id,division_id) REFERENCES bowin_rebuild.divisions(organization_id,tournament_id,id),
  FOREIGN KEY (organization_id,tournament_id,champion_id) REFERENCES bowin_rebuild.competitors(organization_id,tournament_id,id),
  UNIQUE (organization_id,tournament_id,division_id)
);
