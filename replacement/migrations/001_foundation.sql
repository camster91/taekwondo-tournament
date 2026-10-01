CREATE SCHEMA bowin_rebuild;
CREATE TABLE bowin_rebuild.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bowin_rebuild.organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bowin_rebuild.memberships (
  organization_id uuid NOT NULL REFERENCES bowin_rebuild.organizations(id),
  user_id uuid NOT NULL REFERENCES bowin_rebuild.users(id),
  role text NOT NULL CHECK (role IN ('owner','organizer','scorekeeper')),
  PRIMARY KEY (organization_id,user_id)
);
CREATE TABLE bowin_rebuild.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES bowin_rebuild.users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON bowin_rebuild.sessions(expires_at);
CREATE TABLE bowin_rebuild.tournaments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES bowin_rebuild.organizations(id),
  name text NOT NULL,
  event_date date NOT NULL,
  venue text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','registration','running','completed')),
  created_by uuid NOT NULL REFERENCES bowin_rebuild.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id)
);
CREATE INDEX tournaments_organization ON bowin_rebuild.tournaments(organization_id,event_date);
CREATE TABLE bowin_rebuild.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES bowin_rebuild.organizations(id),
  actor_id uuid NOT NULL REFERENCES bowin_rebuild.users(id),
  action text NOT NULL,
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
