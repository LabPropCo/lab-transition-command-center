-- ============================================================================
-- 0028 · LabOS, part 5: Operational Memory
--
-- A second, equally first-class class of information alongside the
-- structured entities in 0027 — the *why* behind the numbers, not the
-- numbers themselves (weekly narrative, pricing rationale, competitive
-- observations, manager comments, decision reasoning, market conditions).
-- Stored verbatim and immutable: content is never edited in place, only
-- superseded, so a future summarization/categorization pass can never lose
-- the original text underneath it. Confirmed design direction — this is
-- what eventually lets the platform answer questions like "when have we
-- used loss-leader pricing, and did it work?" from preserved reasoning, not
-- just from metrics.
--
-- Milestone 1 populates exactly one source: Traffic Detail's Key Notes,
-- linked back to its traffic_leads row via source_ref (a join, not a
-- duplicated column) so narrative/pricing-rationale/manager-comment sources
-- can be added later without a schema change.
-- ============================================================================

create type labos.memory_type as enum (
  'traffic_note',
  'narrative',
  'pricing_rationale',
  'competitive_observation',
  'manager_comment',
  'decision_reasoning',
  'market_condition'
);

create table labos.operational_memory (
  id              uuid primary key default gen_random_uuid(),
  sync_run_id     uuid not null references labos.sync_runs(id),   -- source lineage
  property_id     uuid not null references labos.properties(id),
  reporting_week  date not null,
  memory_type     labos.memory_type not null,
  source_ref      text,                       -- e.g. a traffic_leads.sheet_line_ref; nullable (a standalone
                                               -- narrative entry won't tie to one structured row)
  content         text not null,               -- verbatim, original text — never modified during ingestion
  superseded_by   uuid references labos.operational_memory(id),
  created_at      timestamptz not null default now()
);

-- Immutability enforced, not just documented.
create or replace function labos.prevent_operational_memory_content_edit()
returns trigger language plpgsql as $$
begin
  if new.content is distinct from old.content then
    raise exception 'labos.operational_memory.content is immutable; insert a new row and set superseded_by instead';
  end if;
  return new;
end $$;

create trigger trg_operational_memory_immutable
  before update on labos.operational_memory
  for each row execute function labos.prevent_operational_memory_content_edit();
