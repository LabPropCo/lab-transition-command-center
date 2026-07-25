-- Dev seed (fresh installs via `supabase db reset`). Safe to delete for prod.
-- Builds Arkansas as ONE transition with TWO properties, then instantiates
-- 35 shared (transition-level) + 71 per-property work items, with a realistic
-- demo status mix. NOTE: production uses the non-destructive 0004/0005
-- migration path instead of this seed.

do $$
declare t_id uuid; pa uuid; pb uuid;
begin
  -- Skip if an Arkansas transition already exists (idempotent-ish for dev).
  if exists (select 1 from public.transitions where name='Arkansas Portfolio Transition') then return; end if;
  insert into public.transitions (name, ownership_group, company_name, target_go_live_date, current_phase, overall_status)
    values ('Arkansas Portfolio Transition','Larkspur Capital Partners','Larkspur Capital Partners','2026-08-01','Transition Week','On Track') returning id into t_id;
  insert into public.properties (name, client, transition_date, go_live, units, transition_id)
    values ('Cedar Crossing','Larkspur Capital Partners','2026-06-01','2026-08-01',284,t_id) returning id into pa;
  insert into public.properties (name, client, transition_date, go_live, units, transition_id)
    values ('Magnolia Court','Larkspur Capital Partners','2026-06-01','2026-08-01',196,t_id) returning id into pb;
  perform public.instantiate_transition_work_items(t_id);
  -- Realistic demo status/dates (applied by code across all instances):
  update public.work_items set status='Complete', start_date='2026-05-24', due_date='2026-06-01' where transition_id=t_id and code='T001';
  update public.work_items set status='Complete', start_date='2026-05-25', due_date='2026-06-02' where transition_id=t_id and code='T002';
  update public.work_items set status='Complete', start_date='2026-05-26', due_date='2026-06-03' where transition_id=t_id and code='T003';
  update public.work_items set status='Complete', start_date='2026-06-08', due_date='2026-06-16' where transition_id=t_id and code='T004';
  update public.work_items set status='Complete', start_date='2026-06-09', due_date='2026-06-17' where transition_id=t_id and code='T005';
  update public.work_items set status='Not Started', start_date='2026-07-24', due_date='2026-08-01' where transition_id=t_id and code='T006';
  update public.work_items set status='Not Started', start_date='2026-08-18', due_date='2026-08-26' where transition_id=t_id and code='T007';
  update public.work_items set status='Not Started', start_date='2026-09-12', due_date='2026-09-20' where transition_id=t_id and code='T008';
  update public.work_items set status='Complete', start_date='2026-06-10', due_date='2026-06-18' where transition_id=t_id and code='T009';
  update public.work_items set status='Complete', start_date='2026-06-11', due_date='2026-06-19' where transition_id=t_id and code='T010';
  update public.work_items set status='In Progress', start_date='2026-06-24', due_date='2026-07-02' where transition_id=t_id and code='T011';
  update public.work_items set status='Complete', start_date='2026-06-25', due_date='2026-07-03' where transition_id=t_id and code='T012';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-08', due_date='2026-07-16' where transition_id=t_id and code='T013';
  update public.work_items set status='Not Started', start_date='2026-06-26', due_date='2026-07-04' where transition_id=t_id and code='T014';
  update public.work_items set status='Complete', start_date='2026-06-27', due_date='2026-07-05' where transition_id=t_id and code='T015';
  update public.work_items set status='Complete', start_date='2026-06-28', due_date='2026-07-06' where transition_id=t_id and code='T016';
  update public.work_items set status='In Progress', start_date='2026-07-09', due_date='2026-07-17' where transition_id=t_id and code='T017';
  update public.work_items set status='Not Started', start_date='2026-07-10', due_date='2026-07-18' where transition_id=t_id and code='T018';
  update public.work_items set status='Not Started', start_date='2026-07-16', due_date='2026-07-24' where transition_id=t_id and code='T019';
  update public.work_items set status='Not Started', start_date='2026-07-21', due_date='2026-07-29' where transition_id=t_id and code='T020';
  update public.work_items set status='Not Started', start_date='2026-07-11', due_date='2026-07-19' where transition_id=t_id and code='T021';
  update public.work_items set status='Complete', start_date='2026-06-12', due_date='2026-06-20' where transition_id=t_id and code='T022';
  update public.work_items set status='Complete', start_date='2026-06-13', due_date='2026-06-21' where transition_id=t_id and code='T023';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-06-29', due_date='2026-07-07' where transition_id=t_id and code='T024';
  update public.work_items set status='Not Started', start_date='2026-07-12', due_date='2026-07-20' where transition_id=t_id and code='T025';
  update public.work_items set status='Not Started', start_date='2026-07-22', due_date='2026-07-30' where transition_id=t_id and code='T026';
  update public.work_items set status='Not Started', start_date='2026-08-19', due_date='2026-08-27' where transition_id=t_id and code='T027';
  update public.work_items set status='Not Started', start_date='2026-06-30', due_date='2026-07-08' where transition_id=t_id and code='T028';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-13', due_date='2026-07-21' where transition_id=t_id and code='T029';
  update public.work_items set status='Not Started', start_date='2026-07-14', due_date='2026-07-22' where transition_id=t_id and code='T030';
  update public.work_items set status='Not Started', start_date='2026-07-17', due_date='2026-07-25' where transition_id=t_id and code='T031';
  update public.work_items set status='Waiting on Client', start_date='2026-07-15', due_date='2026-07-23' where transition_id=t_id and code='T032';
  update public.work_items set status='Not Started', start_date='2026-07-18', due_date='2026-07-26' where transition_id=t_id and code='T033';
  update public.work_items set status='Not Started', start_date='2026-07-19', due_date='2026-07-27' where transition_id=t_id and code='T034';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-16', due_date='2026-07-24' where transition_id=t_id and code='T035';
  update public.work_items set status='Not Started', start_date='2026-07-20', due_date='2026-07-28' where transition_id=t_id and code='T036';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-01', due_date='2026-07-09' where transition_id=t_id and code='T037';
  update public.work_items set status='Not Started', start_date='2026-07-17', due_date='2026-07-25' where transition_id=t_id and code='T038';
  update public.work_items set status='In Progress', start_date='2026-07-18', due_date='2026-07-26' where transition_id=t_id and code='T039';
  update public.work_items set status='Not Started', start_date='2026-07-21', due_date='2026-07-29' where transition_id=t_id and code='T040';
  update public.work_items set status='In Progress', start_date='2026-07-02', due_date='2026-07-10' where transition_id=t_id and code='T041';
  update public.work_items set status='Not Started', start_date='2026-07-19', due_date='2026-07-27' where transition_id=t_id and code='T042';
  update public.work_items set status='Not Started', start_date='2026-07-20', due_date='2026-07-28' where transition_id=t_id and code='T043';
  update public.work_items set status='Not Started', start_date='2026-07-22', due_date='2026-07-30' where transition_id=t_id and code='T044';
  update public.work_items set status='Not Started', start_date='2026-07-23', due_date='2026-07-31' where transition_id=t_id and code='T045';
  update public.work_items set status='Complete', start_date='2026-06-14', due_date='2026-06-22' where transition_id=t_id and code='T046';
  update public.work_items set status='In Progress', start_date='2026-07-03', due_date='2026-07-11' where transition_id=t_id and code='T047';
  update public.work_items set status='Not Started', start_date='2026-07-21', due_date='2026-07-29' where transition_id=t_id and code='T048';
  update public.work_items set status='In Progress', start_date='2026-07-22', due_date='2026-07-30' where transition_id=t_id and code='T049';
  update public.work_items set status='Not Started', start_date='2026-07-24', due_date='2026-08-01' where transition_id=t_id and code='T050';
  update public.work_items set status='Not Started', start_date='2026-07-04', due_date='2026-07-12' where transition_id=t_id and code='T051';
  update public.work_items set status='Not Started', start_date='2026-07-25', due_date='2026-08-02' where transition_id=t_id and code='T052';
  update public.work_items set status='In Progress', start_date='2026-07-05', due_date='2026-07-13' where transition_id=t_id and code='T053';
  update public.work_items set status='Waiting on Vendor', start_date='2026-07-23', due_date='2026-07-31' where transition_id=t_id and code='T054';
  update public.work_items set status='Not Started', start_date='2026-07-26', due_date='2026-08-03' where transition_id=t_id and code='T055';
  update public.work_items set status='Not Started', start_date='2026-07-27', due_date='2026-08-04' where transition_id=t_id and code='T056';
  update public.work_items set status='Complete', start_date='2026-06-15', due_date='2026-06-23' where transition_id=t_id and code='T057';
  update public.work_items set status='Complete', start_date='2026-06-16', due_date='2026-06-24' where transition_id=t_id and code='T058';
  update public.work_items set status='Complete', start_date='2026-07-06', due_date='2026-07-14' where transition_id=t_id and code='T059';
  update public.work_items set status='Complete', start_date='2026-07-07', due_date='2026-07-15' where transition_id=t_id and code='T060';
  update public.work_items set status='Waiting on Vendor', start_date='2026-07-24', due_date='2026-08-01' where transition_id=t_id and code='T061';
  update public.work_items set status='Not Started', start_date='2026-07-25', due_date='2026-08-02' where transition_id=t_id and code='T062';
  update public.work_items set status='Not Started', start_date='2026-07-28', due_date='2026-08-05' where transition_id=t_id and code='T063';
  update public.work_items set status='Not Started', start_date='2026-07-29', due_date='2026-08-06' where transition_id=t_id and code='T064';
  update public.work_items set status='Waiting on Vendor', start_date='2026-07-26', due_date='2026-08-03' where transition_id=t_id and code='T065';
  update public.work_items set status='Not Started', start_date='2026-07-30', due_date='2026-08-07' where transition_id=t_id and code='T066';
  update public.work_items set status='Complete', start_date='2026-07-08', due_date='2026-07-16' where transition_id=t_id and code='T067';
  update public.work_items set status='In Progress', start_date='2026-07-09', due_date='2026-07-17' where transition_id=t_id and code='T068';
  update public.work_items set status='Complete', start_date='2026-07-10', due_date='2026-07-18' where transition_id=t_id and code='T069';
  update public.work_items set status='Complete', start_date='2026-07-11', due_date='2026-07-19' where transition_id=t_id and code='T070';
  update public.work_items set status='Not Started', start_date='2026-07-27', due_date='2026-08-04' where transition_id=t_id and code='T071';
  update public.work_items set status='Not Started', start_date='2026-07-28', due_date='2026-08-05' where transition_id=t_id and code='T072';
  update public.work_items set status='Complete', start_date='2026-06-17', due_date='2026-06-25' where transition_id=t_id and code='T073';
  update public.work_items set status='Blocked', start_date='2026-07-12', due_date='2026-07-20' where transition_id=t_id and code='T074';
  update public.work_items set status='Not Started', start_date='2026-07-13', due_date='2026-07-21' where transition_id=t_id and code='T075';
  update public.work_items set status='Not Started', start_date='2026-07-29', due_date='2026-08-06' where transition_id=t_id and code='T076';
  update public.work_items set status='Not Started', start_date='2026-07-30', due_date='2026-08-07' where transition_id=t_id and code='T077';
  update public.work_items set status='Not Started', start_date='2026-07-31', due_date='2026-08-08' where transition_id=t_id and code='T078';
  update public.work_items set status='Not Started', start_date='2026-07-31', due_date='2026-08-08' where transition_id=t_id and code='T079';
  update public.work_items set status='In Progress', start_date='2026-07-14', due_date='2026-07-22' where transition_id=t_id and code='T080';
  update public.work_items set status='In Progress', start_date='2026-07-15', due_date='2026-07-23' where transition_id=t_id and code='T081';
  update public.work_items set status='Not Started', start_date='2026-08-01', due_date='2026-08-09' where transition_id=t_id and code='T082';
  update public.work_items set status='Not Started', start_date='2026-08-02', due_date='2026-08-10' where transition_id=t_id and code='T083';
  update public.work_items set status='Not Started', start_date='2026-08-03', due_date='2026-08-11' where transition_id=t_id and code='T084';
  update public.work_items set status='Not Started', start_date='2026-08-01', due_date='2026-08-09' where transition_id=t_id and code='T085';
  update public.work_items set status='Not Started', start_date='2026-08-02', due_date='2026-08-10' where transition_id=t_id and code='T086';
  update public.work_items set status='Not Started', start_date='2026-07-23', due_date='2026-07-31' where transition_id=t_id and code='T087';
  update public.work_items set status='In Progress', start_date='2026-08-04', due_date='2026-08-12' where transition_id=t_id and code='T088';
  update public.work_items set status='Not Started', start_date='2026-08-03', due_date='2026-08-11' where transition_id=t_id and code='T089';
  update public.work_items set status='Not Started', start_date='2026-08-04', due_date='2026-08-12' where transition_id=t_id and code='T090';
  update public.work_items set status='Not Started', start_date='2026-07-24', due_date='2026-08-01' where transition_id=t_id and code='T091';
  update public.work_items set status='Not Started', start_date='2026-07-28', due_date='2026-08-05' where transition_id=t_id and code='T092';
  update public.work_items set status='Not Started', start_date='2026-07-29', due_date='2026-08-06' where transition_id=t_id and code='T093';
  update public.work_items set status='Not Started', start_date='2026-07-25', due_date='2026-08-02' where transition_id=t_id and code='T094';
  update public.work_items set status='Not Started', start_date='2026-07-30', due_date='2026-08-07' where transition_id=t_id and code='T095';
  update public.work_items set status='Not Started', start_date='2026-07-31', due_date='2026-08-08' where transition_id=t_id and code='T096';
  update public.work_items set status='Not Started', start_date='2026-08-01', due_date='2026-08-09' where transition_id=t_id and code='T097';
  update public.work_items set status='Not Started', start_date='2026-08-20', due_date='2026-08-28' where transition_id=t_id and code='T098';
  update public.work_items set status='Not Started', start_date='2026-08-21', due_date='2026-08-29' where transition_id=t_id and code='T099';
  update public.work_items set status='Not Started', start_date='2026-08-22', due_date='2026-08-30' where transition_id=t_id and code='T100';
  update public.work_items set status='Not Started', start_date='2026-08-23', due_date='2026-08-31' where transition_id=t_id and code='T101';
  update public.work_items set status='Not Started', start_date='2026-08-24', due_date='2026-09-01' where transition_id=t_id and code='T102';
  update public.work_items set status='Not Started', start_date='2026-09-13', due_date='2026-09-21' where transition_id=t_id and code='T103';
  update public.work_items set status='Not Started', start_date='2026-09-14', due_date='2026-09-22' where transition_id=t_id and code='T104';
  update public.work_items set status='Not Started', start_date='2026-09-15', due_date='2026-09-23' where transition_id=t_id and code='T105';
  update public.work_items set status='Not Started', start_date='2026-09-16', due_date='2026-09-24' where transition_id=t_id and code='T106';
end $$;

-- Reset audit so testers see only their own actions.
delete from public.audit_log;
