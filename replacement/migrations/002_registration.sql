CREATE TABLE bowin_rebuild.divisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  name text NOT NULL,
  discipline text NOT NULL CHECK (discipline IN ('sparring','patterns')),
  format text NOT NULL CHECK (format IN ('single_elimination','scored_final')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked','running','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,tournament_id) REFERENCES bowin_rebuild.tournaments(organization_id,id),
  UNIQUE (organization_id,tournament_id,id),
  UNIQUE (tournament_id,name)
);
CREATE TABLE bowin_rebuild.competitors (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  name text NOT NULL,
  club text NOT NULL,
  public_display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,tournament_id) REFERENCES bowin_rebuild.tournaments(organization_id,id),
  UNIQUE (organization_id,tournament_id,id)
);
CREATE TABLE bowin_rebuild.registrations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  competitor_id uuid NOT NULL,
  division_id uuid NOT NULL,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES bowin_rebuild.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,tournament_id,competitor_id) REFERENCES bowin_rebuild.competitors(organization_id,tournament_id,id),
  FOREIGN KEY (organization_id,tournament_id,division_id) REFERENCES bowin_rebuild.divisions(organization_id,tournament_id,id),
  UNIQUE (organization_id,tournament_id,competitor_id,division_id)
);
CREATE INDEX registration_division ON bowin_rebuild.registrations(organization_id,tournament_id,division_id);
