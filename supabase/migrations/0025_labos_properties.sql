-- ============================================================================
-- 0025 · LabOS, part 2: reference data (properties, floorplans, units)
--
-- Milestone 1 scope: a single property (River Run). The shape supports more
-- than one from day one because it costs nothing extra now and it's the
-- obvious next step after Milestone 1 — but no second property is seeded or
-- assumed anywhere in this milestone's code.
-- ============================================================================

create table labos.properties (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,             -- 'River Run'
  created_at timestamptz not null default now()
);

create table labos.floorplans (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references labos.properties(id),
  type_code    text not null,                  -- e.g. 'A1R', 'B2', 'C1R' — from the Inventory sheet
  bed_count    int not null,
  river_side   boolean not null,
  description  text,                           -- e.g. '1 BED RIVER'
  unique (property_id, type_code)
);

create table labos.units (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references labos.properties(id),
  unit_number   text not null,                 -- e.g. 'E304'
  floorplan_id  uuid references labos.floorplans(id),  -- nullable: unit seen before Inventory resolves it (V9)
  sqft          int,
  unique (property_id, unit_number)
);
