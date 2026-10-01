ALTER TABLE bowin_rebuild.tournaments
  ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN public_id uuid UNIQUE,
  ADD COLUMN publication_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE bowin_rebuild.division_schedule (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  division_id uuid NOT NULL,
  ring text NOT NULL CHECK(length(ring) BETWEEN 1 AND 40),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '8 hours'),
  FOREIGN KEY (organization_id,tournament_id,division_id) REFERENCES bowin_rebuild.divisions(organization_id,tournament_id,id),
  UNIQUE (organization_id,tournament_id,division_id)
);
CREATE INDEX division_schedule_ring ON bowin_rebuild.division_schedule(organization_id,tournament_id,ring,starts_at);
