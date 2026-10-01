CREATE TABLE bowin_rebuild.invites (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES bowin_rebuild.organizations(id),
  email text NOT NULL CHECK (email=lower(email)),
  role text NOT NULL CHECK (role IN ('organizer','scorekeeper')),
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES bowin_rebuild.users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
