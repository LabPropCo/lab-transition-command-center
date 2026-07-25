-- Operational data correction — run SEPARATELY, BEFORE migration 0014.
-- This is NOT a schema migration and is NOT part of the numbered upgrade path.
--
-- Live execution order (performed/approved by the product owner):
--   1. Run the invalid-value detection query (below).
--   2. Confirm T107 is the ONLY result.
--   3. Run the guarded correction and confirm EXACTLY ONE returned row.
--   4. Re-run detection and confirm ZERO invalid rows.
--   5. Apply migration 0014.
--   6. notify pgrst, 'reload schema';
--   7. Re-test Synchronize.

-- (1) Detection query — read-only.
select code, responsible_party
from public.work_item_templates
where responsible_party is not null
  and responsible_party not in ('The Lab','Client','Prior Manager','Vendor','Shared')
order by code;
-- Expected: exactly one row -> T107 = 'Property Manager'.

-- (3) Guarded correction. Expected result: exactly ONE returned row.
-- If it returns zero rows or more than one row, STOP and investigate.
-- Do not continue to migration 0014.
update public.work_item_templates
   set responsible_party = 'The Lab'
 where code = 'T107'
   and responsible_party = 'Property Manager'
returning id, code, responsible_party;

-- (4) Re-run the detection query above; expect zero rows before applying 0014.
