#!/usr/bin/env python3
"""
Release-validation gate for The Lab Transition Command Center.

Validates the *packaged artifact* (the ZIP), not just the working tree. Run this
before shipping any package. It performs six independent checks and exits
non-zero if any fail:

  A. Migration presence & sequence  — every NNNN_*.sql present, contiguous, named.
  B. Clean rebuild from the ZIP     — fresh Postgres, migrations+seed from the ZIP only.
  C. Acceptance on the clean rebuild — run as the un-privileged `authenticated`
                                        role, so missing table GRANTs FAIL here.
  D. Idempotency                     — re-apply the whole chain; must not error,
                                        counts unchanged (safe manual re-runs).
  E. ZIP <-> tree parity            — every source file identical in both.
  F. Applied-vs-repo drift          — flag versions applied in the DB history
                                        but missing from the repo (and vice versa).

Requires: pip install pgserver psycopg2-binary
Usage:
  python scripts/release_check.py --zip dist_pkg.zip --tree . \
      [--applied 0001,0002,...]  [--applied-dsn postgres://...]
"""
from __future__ import annotations
import argparse, hashlib, os, re, sys, tempfile, zipfile, glob

GREEN, RED, YEL, DIM, RST = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"
def ok(m):   print(f"{GREEN}  PASS{RST} {m}")
def bad(m):  print(f"{RED}  FAIL{RST} {m}")
def warn(m): print(f"{YEL}  WARN{RST} {m}")
def head(m): print(f"\n{m}")

MIG_RE = re.compile(r"^(\d{4})_([A-Za-z0-9_]+)\.sql$")
EXCLUDE_DIRS = {"node_modules", "dist", ".git", ".vite"}
EXCLUDE_SUFFIX = (".tsbuildinfo",)


# ---------------------------------------------------------------- helpers -----
def zip_root(zf: zipfile.ZipFile) -> str:
    tops = {n.split("/", 1)[0] for n in zf.namelist() if n.strip()}
    return (tops.pop() + "/") if len(tops) == 1 else ""

def read_zip_migrations(zip_path: str) -> dict[str, str]:
    out = {}
    with zipfile.ZipFile(zip_path) as zf:
        root = zip_root(zf)
        for n in zf.namelist():
            rel = n[len(root):] if n.startswith(root) else n
            if rel.startswith("supabase/migrations/") and rel.endswith(".sql"):
                out[os.path.basename(rel)] = zf.read(n).decode("utf-8")
    return dict(sorted(out.items()))

def read_zip_seed(zip_path: str) -> str | None:
    with zipfile.ZipFile(zip_path) as zf:
        root = zip_root(zf)
        for n in zf.namelist():
            if n[len(root):] == "supabase/seed.sql":
                return zf.read(n).decode("utf-8")
    return None

def file_hashes(base: str) -> dict[str, str]:
    """Hash all tracked files under base (dir) or inside a zip."""
    res = {}
    if base.endswith(".zip"):
        with zipfile.ZipFile(base) as zf:
            root = zip_root(zf)
            for n in zf.namelist():
                if n.endswith("/"):
                    continue
                rel = n[len(root):] if n.startswith(root) else n
                parts = set(rel.split("/"))
                if parts & EXCLUDE_DIRS or rel.endswith(EXCLUDE_SUFFIX):
                    continue
                res[rel] = hashlib.sha256(zf.read(n)).hexdigest()
        return res
    for dirpath, dirnames, filenames in os.walk(base):
        # prune excluded directories in place (also handles hidden dirs we skip)
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:  # os.walk includes dotfiles, unlike glob
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, base)
            parts = set(rel.split(os.sep))
            if parts & EXCLUDE_DIRS or rel.endswith(EXCLUDE_SUFFIX):
                continue
            with open(path, "rb") as fh:
                res[rel.replace(os.sep, "/")] = hashlib.sha256(fh.read()).hexdigest()
    return res


# --------------------------------------------------------- DB scaffolding -----
AUTH_SCAFFOLD = """
create schema if not exists auth;
create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
"""
# NOTE: deliberately NO `alter default privileges ... grant ... to authenticated`.
# This makes the harness STRICTER than Supabase so that any table missing an
# explicit GRANT fails check C — exactly the 0007 class of bug.

def apply_sql(cur, sql: str):
    cur.execute(sql)

def as_role(cur, role: str, uid: str | None):
    cur.execute(f"set role {role}")
    cur.execute("set app.uid=%s", (uid or "",))
def reset_role(cur):
    cur.execute("reset role"); cur.execute("set app.uid=''")


# ------------------------------------------------------------- the checks -----
def check_sequence(migrations: dict[str, str]) -> bool:
    head("A. Migration presence & sequence")
    nums = []
    for fn in migrations:
        m = MIG_RE.match(fn)
        if not m:
            bad(f"badly named migration: {fn}"); return False
        nums.append(int(m.group(1)))
    nums.sort()
    if not nums:
        bad("no migrations found in package"); return False
    expected = list(range(1, nums[-1] + 1))
    missing = sorted(set(expected) - set(nums))
    dupes = sorted({n for n in nums if nums.count(n) > 1})
    if missing:
        bad(f"missing migration number(s): {['%04d' % n for n in missing]}"); return False
    if dupes:
        bad(f"duplicate migration number(s): {dupes}"); return False
    ok(f"{len(nums)} migrations present and contiguous 0001..{nums[-1]:04d}")
    return True


def build_clean_db(migrations, seed):
    import pgserver, psycopg2
    srv = pgserver.get_server(tempfile.mkdtemp())
    conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
    cur = conn.cursor()
    apply_sql(cur, AUTH_SCAFFOLD)
    for fn in sorted(migrations):
        apply_sql(cur, migrations[fn])
    if seed:
        apply_sql(cur, seed)
    return srv, conn, cur


def check_clean_rebuild(migrations, seed):
    head("B. Clean database rebuild from the ZIP only")
    try:
        srv, conn, cur = build_clean_db(migrations, seed)
    except Exception as e:
        bad(f"clean rebuild raised: {str(e).splitlines()[0]}"); return None
    cur.execute("select count(*) from public.work_items")
    ok(f"applied {len(migrations)} migrations + seed on a fresh DB; work_items={cur.fetchone()[0]}")
    return (srv, conn, cur)


def check_acceptance(cur) -> bool:
    head("C. Acceptance on the clean rebuild (as un-privileged `authenticated`)")
    passed = True
    # test users
    cur.execute("insert into auth.users(email) values ('admin@lab.test') returning id"); admin = cur.fetchone()[0]
    cur.execute("insert into auth.users(email) values ('member@lab.test') returning id"); member = cur.fetchone()[0]
    cur.execute("insert into auth.users(email) values ('out@x.test') returning id"); outsider = cur.fetchone()[0]
    cur.execute("update public.profiles set is_platform_admin=true where id=%s", (admin,))
    cur.execute("select id from public.transitions limit 1"); tid = cur.fetchone()[0]
    cur.execute("insert into public.transition_members(transition_id,user_id,role) values (%s,%s,'transition_team')", (tid, member))

    def expect(label, got, want):
        nonlocal passed
        (ok if got == want else bad)(f"{label}: {got} (expected {want})")
        if got != want: passed = False

    # As authenticated ADMIN — this is where a missing GRANT throws.
    try:
        as_role(cur, "authenticated", admin)
        cur.execute("select count(*) from public.transitions");   t = cur.fetchone()[0]
        cur.execute("select count(*) from public.properties");    p = cur.fetchone()[0]
        cur.execute("select count(*) from public.work_items");    w = cur.fetchone()[0]
        cur.execute("select count(*) from public.work_items where scope_type='transition'"); sh = cur.fetchone()[0]
    except Exception as e:
        reset_role(cur)
        bad(f"authenticated read failed (likely a missing GRANT): {str(e).splitlines()[0]}")
        return False
    reset_role(cur)
    expect("admin sees transitions", t, 1)
    expect("admin sees properties", p, 2)
    expect("admin sees work_items", w, 177)
    expect("shared (transition-level) items", sh, 35)

    # Outsider is blocked by RLS.
    as_role(cur, "authenticated", outsider)
    cur.execute("select count(*) from public.work_items"); ow = cur.fetchone()[0]
    reset_role(cur)
    expect("outsider sees work_items", ow, 0)

    # Restricted member: limit to first property -> shared + that property only.
    cur.execute("select id from public.properties order by name limit 1"); pa = cur.fetchone()[0]
    cur.execute("insert into public.transition_member_properties(transition_id,user_id,property_id) values (%s,%s,%s)", (tid, member, pa))
    as_role(cur, "authenticated", member)
    cur.execute("select count(*) from public.work_items"); mw = cur.fetchone()[0]
    reset_role(cur)
    expect("restricted member sees (35 shared + 71 property A)", mw, 106)

    # Audit fires on an edit (through RLS as admin).
    as_role(cur, "authenticated", admin)
    cur.execute("select id from public.work_items where status<>'Complete' limit 1"); wid = cur.fetchone()[0]
    cur.execute("update public.work_items set status='Complete' where id=%s", (wid,))
    reset_role(cur)
    cur.execute("select count(*) from public.audit_log where work_item_id=%s and field='status'", (wid,))
    expect("audit row written on status change", cur.fetchone()[0], 1)

    # Scope is configurable: flip a template; existing transition unchanged.
    cur.execute("select scope_type from public.work_item_templates where code='T015'"); before = cur.fetchone()[0]
    as_role(cur, "authenticated", admin)
    cur.execute("update public.work_item_templates set scope_type='transition' where code='T015'")
    reset_role(cur)
    cur.execute("select count(*) from public.work_items"); after = cur.fetchone()[0]
    expect("existing transition unchanged after scope flip", after, 177)
    # New provisioning reflects the change.
    cur.execute("insert into public.transitions(name) values ('Probe') returning id"); tb = cur.fetchone()[0]
    cur.execute("insert into public.properties(name,transition_id) values ('PB1',%s)", (tb,))
    cur.execute("select public.instantiate_transition_work_items(%s)", (tb,))
    cur.execute("select scope_type from public.work_items where transition_id=%s and code='T015'", (tb,))
    row = cur.fetchone()
    expect("new provisioning uses new scope", row[0] if row else None, "transition")
    # Explicit reprovision is additive (adds shared T015, keeps per-property).
    as_role(cur, "authenticated", admin)
    cur.execute("select public.reprovision_transition(%s)", (tid,))
    reset_role(cur)
    cur.execute("select count(*) from public.work_items where transition_id=%s and code='T015'", (tid,))
    expect("reprovision additive (shared added, per-property kept)", cur.fetchone()[0], 3)
    cur.execute("update public.work_item_templates set scope_type=%s where code='T015'", (before,))  # restore

    # Admin: transition settings are editable by an admin (grant + RLS + audit),
    # and blocked for non-admins.
    as_role(cur, "authenticated", admin)
    cur.execute("update public.transitions set company_name='Renamed Co' where id=%s", (tid,))
    reset_role(cur)
    cur.execute("select count(*) from public.admin_audit_log where entity_type='transition' and field='company_name'")
    expect("admin transition edit is audited", cur.fetchone()[0] >= 1, True)
    as_role(cur, "authenticated", outsider)
    cur.execute("update public.transitions set name='x' where id=%s", (tid,))
    blocked = cur.rowcount
    reset_role(cur)
    expect("non-admin transition edit blocked", blocked, 0)

    # Phase 2: methodology CRUD + synchronization + versioning.
    as_role(cur, "authenticated", admin)
    cur.execute("""insert into public.work_item_templates
      (code,sort_order,phase,phase_order,workstream,sub_workstream,description,completion_standard,
       default_owner,responsible_party,priority,go_live_gate,critical_path,scope_type)
      values ('T900',900,'Go Live',6,'Executive & Legal','Executive','Gate check','done',
       'X','The Lab','High',true,false,'transition')""")
    reset_role(cur)
    cur.execute("select count(*) from public.sync_preview(%s) where code='T900' and change_type='add'", (tid,))
    expect("methodology add appears in sync preview", cur.fetchone()[0], 1)
    as_role(cur, "authenticated", admin)
    cur.execute("select public.apply_transition_sync(%s, true, false, false, false, true)", (tid,))
    reset_role(cur)
    cur.execute("select count(*) from public.work_items where transition_id=%s and code='T900'", (tid,))
    expect("synced new item added to transition", cur.fetchone()[0], 1)
    as_role(cur, "authenticated", admin)
    cur.execute("select public.publish_methodology_version('v-test','gate')")
    reset_role(cur)
    cur.execute("select count(*) from public.methodology_versions")
    expect("methodology version published", cur.fetchone()[0] >= 2, True)
    # Idempotency (#1): after a full apply, a second preview has no actionable deltas.
    as_role(cur, "authenticated", admin)
    cur.execute("select public.apply_transition_sync(%s, true, true, true, true, true)", (tid,))
    cur.execute("select count(*) from public.sync_preview(%s) where change_type in ('add','rename','metadata','due')", (tid,))
    leftover = cur.fetchone()[0]
    reset_role(cur)
    expect("sync is idempotent (no actionable deltas on re-preview)", leftover, 0)
    # Immutable-id matching (#2): editing a template code creates no phantom add.
    as_role(cur, "authenticated", admin)
    cur.execute("update public.work_item_templates set code='T900-NEWID' where code='T900'")
    cur.execute("""select count(*) from public.sync_preview(%s) where change_type='add'
                   and template_id=(select id from public.work_item_templates where code='T900-NEWID')""", (tid,))
    phantom = cur.fetchone()[0]
    reset_role(cur)
    expect("code edit keeps immutable-id match (no phantom add)", phantom, 0)
    # Deferral tracks the specific delta (#Q1): Ignore hides the declined delta,
    # but a fresh change to the same template re-surfaces a new delta.
    tpl = "(select id from public.work_item_templates where code='T900-NEWID')"
    as_role(cur, "authenticated", admin)
    cur.execute("update public.work_item_templates set description='Gate check v2' where code='T900-NEWID'")
    cur.execute(f"select public.defer_sync_change(%s, {tpl}, 'rename')", (tid,))
    cur.execute(f"select count(*) from public.sync_preview(%s) where change_type='rename' and template_id={tpl}", (tid,))
    hidden = cur.fetchone()[0]
    cur.execute("update public.work_item_templates set description='Gate check v3' where code='T900-NEWID'")
    cur.execute(f"select count(*) from public.sync_preview(%s) where change_type='rename' and template_id={tpl}", (tid,))
    reappeared = cur.fetchone()[0]
    reset_role(cur)
    expect("deferral hides the exact declined delta", hidden, 0)
    expect("deferral releases when the delta changes", reappeared, 1)
    # Delete protection (#Q2): used/versioned templates are archive-only.
    as_role(cur, "authenticated", admin)
    try:
        cur.execute("delete from public.work_item_templates where code='T900-NEWID'"); del_used_blocked = False
    except Exception:
        del_used_blocked = True
    reset_role(cur)
    expect("used template cannot be hard-deleted", del_used_blocked, True)
    as_role(cur, "authenticated", admin)
    cur.execute("""insert into public.work_item_templates
      (code,sort_order,phase,phase_order,workstream,sub_workstream,description,completion_standard,
       default_owner,responsible_party,priority,go_live_gate,critical_path,scope_type)
      values ('TMPGATE',997,'Go Live',6,'Executive & Legal','Executive','tmp','x','X','The Lab','Low',false,false,'transition')""")
    cur.execute("delete from public.work_item_templates where code='TMPGATE'")
    unused_deleted = cur.rowcount
    reset_role(cur)
    expect("unused/never-versioned template can be hard-deleted", unused_deleted, 1)
    # No-op synchronization writes no audit entry; a changing one still does.
    as_role(cur, "authenticated", admin)
    cur.execute("select public.apply_transition_sync(%s, true, true, true, true, true)", (tid,))  # reconcile
    cur.execute("select count(*) from public.admin_audit_log where entity_type='transition_sync' and entity_id=%s", (tid,))
    a0 = cur.fetchone()[0]
    cur.execute("select public.apply_transition_sync(%s, true, true, true, true, true)", (tid,))  # now a no-op
    cur.execute("select count(*) from public.admin_audit_log where entity_type='transition_sync' and entity_id=%s", (tid,))
    a1 = cur.fetchone()[0]
    reset_role(cur)
    expect("no-op sync writes no audit entry", a1, a0)
    # Community Director (0012): blank allowed on create; setting it persists + audits.
    reset_role(cur); cur.execute("set app.uid = %s", (admin,))
    cur.execute("insert into public.transitions (name, overall_status) values ('Gate CD Co','On Track') returning id, community_director_id")
    cd_tid, cd_blank = cur.fetchone()
    cur.execute("set app.uid = ''")
    expect("new transition allows a blank Community Director", cd_blank is None, True)
    as_role(cur, "authenticated", admin)
    cur.execute("update public.transitions set community_director_id=%s, community_director_name='Admin' where id=%s", (admin, cd_tid))
    reset_role(cur)
    cur.execute("select community_director_id::text from public.transitions where id=%s", (cd_tid,))
    expect("Community Director persists", cur.fetchone()[0], str(admin))
    cur.execute("select count(*) from public.admin_audit_log where entity_type='transition' and entity_id=%s and field='community_director_id'", (cd_tid,))
    expect("Community Director change is audited", cur.fetchone()[0] >= 1, True)
    # Clearing is audited with the prior id -> null.
    as_role(cur, "authenticated", admin)
    cur.execute("update public.transitions set community_director_id=null, community_director_name=null where id=%s", (cd_tid,))
    reset_role(cur)
    cur.execute("""select count(*) from public.admin_audit_log where entity_type='transition' and entity_id=%s
                   and field='community_director_id' and old_value=%s and new_value is null""", (cd_tid, str(admin)))
    expect("Community Director clear is audited (old id -> null)", cur.fetchone()[0] >= 1, True)
    # FK ON DELETE SET NULL: deleting the assigned user clears it, never blocks.
    reset_role(cur)
    cur.execute("insert into auth.users(email) values ('cdgate@lab.test') returning id")
    cdu = cur.fetchone()[0]
    cur.execute("update public.transitions set community_director_id=%s where id=%s", (cdu, cd_tid))
    cur.execute("delete from auth.users where id=%s", (cdu,))
    cur.execute("select community_director_id from public.transitions where id=%s", (cd_tid,))
    expect("deleting the CD user nulls the assignment (FK SET NULL)", cur.fetchone()[0], None)
    # Default ownership (0011, unchanged): sync-added unassigned items default owner
    # to the creator while the methodology owner ROLE is preserved.
    as_role(cur, "authenticated", admin)
    cur.execute("""insert into public.work_item_templates
      (code,sort_order,phase,phase_order,workstream,sub_workstream,description,completion_standard,
       default_owner,responsible_party,priority,go_live_gate,critical_path,scope_type)
      values ('TNOGATE',995,'Go Live',6,'Executive & Legal','Executive','unassigned','x',
       null,'The Lab','High',false,false,'transition')""")
    cur.execute("select public.apply_transition_sync(%s, true, false, false, false, true)", (tid,))
    reset_role(cur)
    cur.execute("select owner, responsible_party from public.work_items where transition_id=%s and code='TNOGATE'", (tid,))
    o_owner, o_role = cur.fetchone()
    expect("sync-added unassigned owner defaults to creator", o_owner is not None, True)
    expect("sync-added preserves methodology owner role", o_role, "The Lab")
    # Property administration (0013): rename persists + audited + preserves work
    # items; add creates no work items; non-admin blocked. CD name is free text.
    cur.execute("select count(*) from public.work_items"); wi_before = cur.fetchone()[0]
    as_role(cur, "authenticated", admin)
    cur.execute("select id from public.properties where transition_id=%s order by name limit 1", (tid,))
    prop = cur.fetchone()[0]
    cur.execute("select count(*) from public.work_items where property_id=%s", (prop,)); prop_wi = cur.fetchone()[0]
    cur.execute("update public.properties set name='Cedar Crossing (Renamed)', city='Fayetteville', active=true where id=%s", (prop,))
    cur.execute("insert into public.properties (name, transition_id) values ('Gate New Property', %s)", (tid,))
    reset_role(cur)
    cur.execute("select count(*) from public.work_items where property_id=%s", (prop,))
    expect("property rename preserves its work items", cur.fetchone()[0], prop_wi)
    cur.execute("select count(*) from public.work_items")
    expect("property admin creates/deletes no work items", cur.fetchone()[0], wi_before)
    cur.execute("select count(*) from public.admin_audit_log where entity_type='property' and entity_id=%s and field='name'", (prop,))
    expect("property rename is audited", cur.fetchone()[0] >= 1, True)
    as_role(cur, "authenticated", outsider)
    cur.execute("update public.properties set name='hack' where id=%s", (prop,)); pblk = cur.rowcount
    reset_role(cur)
    expect("non-admin cannot edit properties", pblk, 0)
    as_role(cur, "authenticated", admin)
    cur.execute("update public.transitions set community_director_name='Jane Smith' where id=%s", (tid,))
    reset_role(cur)
    cur.execute("select community_director_name, community_director_id from public.transitions where id=%s", (tid,))
    cdn, cdi = cur.fetchone()
    expect("CD free-text name persists", cdn, "Jane Smith")
    expect("CD id stays null (name is free text)", cdi is None, True)
    cur.execute("select count(*) from public.admin_audit_log where entity_type='transition' and entity_id=%s and field='community_director_name'", (tid,))
    expect("CD name change is audited", cur.fetchone()[0] >= 1, True)
    as_role(cur, "authenticated", outsider)
    try:
        cur.execute("select public.apply_transition_sync(%s, true, false, false, false, true)", (tid,)); nb = False
    except Exception:
        nb = True
    reset_role(cur)
    expect("non-admin sync blocked", nb, True)
    return passed


def check_template_vocab(migrations, seed) -> bool:
    """0014: controlled responsible_party vocabulary on work_item_templates,
    validated on an ISOLATED clean DB (Arkansas: 1 transition, 2 properties) so
    per-property counts are deterministic and unaffected by other checks."""
    head("H. Template responsible_party vocabulary (0014) + T107 synchronize")
    srv, conn, cur = build_clean_db(migrations, seed)
    state = {"passed": True}
    def expect(label, got, want):
        (ok if got == want else bad)(f"{label}: {got} (expected {want})")
        if got != want: state["passed"] = False
    try:
        cur.execute("insert into auth.users(email) values ('admin@lab.test') returning id"); admin = cur.fetchone()[0]
        cur.execute("update public.profiles set is_platform_admin=true where id=%s", (admin,))
        cur.execute("select id from public.transitions limit 1"); tid = cur.fetchone()[0]
        cur.execute("select count(*) from public.properties where transition_id=%s", (tid,)); nprop = cur.fetchone()[0]
        expect("clean Arkansas has two properties", nprop, 2)

        cur.execute("select count(*) from pg_constraint where conname='work_item_templates_resp_chk' and conrelid='public.work_item_templates'::regclass")
        expect("0014 template CHECK present (existing seeded templates passed it)", cur.fetchone()[0], 1)

        as_role(cur, "authenticated", admin)
        try:
            cur.execute("""insert into public.work_item_templates
              (code,sort_order,phase,phase_order,workstream,sub_workstream,description,completion_standard,
               default_owner,responsible_party,priority,go_live_gate,critical_path,scope_type)
              values ('T107X',908,'Go Live',6,'Operations','Ops','x','y',null,'Property Manager','High',false,false,'property')""")
            inv_ins = False
        except Exception: inv_ins = True
        reset_role(cur)
        expect("DB rejects invalid template responsible_party (direct insert)", inv_ins, True)

        as_role(cur, "authenticated", admin)
        try:
            cur.execute("update public.work_item_templates set responsible_party='Property Manager' where code='T001'")
            inv_upd = False
        except Exception: inv_upd = True
        reset_role(cur)
        expect("DB rejects invalid template responsible_party (direct update)", inv_upd, True)

        as_role(cur, "authenticated", admin)
        cur.execute("""insert into public.work_item_templates
          (code,sort_order,phase,phase_order,workstream,sub_workstream,description,completion_standard,
           default_owner,responsible_party,priority,go_live_gate,critical_path,scope_type)
          values ('T107',907,'Go Live',6,'Operations','Ops','New ops task','done',null,'The Lab','High',false,false,'property')""")
        reset_role(cur)
        cur.execute("select responsible_party from public.work_item_templates where code='T107'")
        expect("valid template responsible_party saves ('The Lab')", cur.fetchone()[0], "The Lab")

        cur.execute("select id,status,owner from public.work_items where transition_id=%s and status='Complete' and code='T001' limit 1", (tid,))
        comp = cur.fetchone()
        cur.execute("select count(*) from public.work_items where transition_id=%s and code='T018'", (tid,)); t018_before = cur.fetchone()[0]
        cur.execute("select count(*) from public.work_items where transition_id=%s", (tid,)); wi_before = cur.fetchone()[0]

        as_role(cur, "authenticated", admin)
        cur.execute("update public.work_item_templates set due_offset_days = coalesce(due_offset_days,0) + 3 where code='T030'")
        reset_role(cur)
        cur.execute("select count(*) from public.sync_preview(%s) where code='T030' and change_type='due'", (tid,))
        expect("T030 due change previews per-property (x2)", cur.fetchone()[0], 2)
        cur.execute("select count(*) from public.sync_preview(%s) where code='T107' and change_type='add'", (tid,))
        expect("T107 add previews exactly two (one per property)", cur.fetchone()[0], 2)

        as_role(cur, "authenticated", admin)
        cur.execute("select public.apply_transition_sync(%s, true, false, false, true, true)", (tid,))  # add + due, protect completed
        reset_role(cur)
        cur.execute("select count(*) from public.work_items where transition_id=%s and code='T107'", (tid,))
        expect("Synchronize creates exactly two T107 work items", cur.fetchone()[0], 2)
        cur.execute("select count(*) from public.work_items where transition_id=%s and code='T107' and responsible_party='The Lab'", (tid,))
        expect("both T107 items use 'The Lab'", cur.fetchone()[0], 2)
        cur.execute("select count(*) from public.work_items where transition_id=%s and code='T018'", (tid,))
        expect("T018 items retained (not deleted by sync)", cur.fetchone()[0], t018_before)
        cur.execute("select count(*) from public.work_items where transition_id=%s", (tid,))
        expect("Synchronize added exactly the two T107 items (atomic, nothing else)", cur.fetchone()[0], wi_before + 2)
        if comp:
            cur.execute("select status, owner from public.work_items where id=%s", (comp[0],))
            expect("completed T001 protected across Synchronize", tuple(cur.fetchone()), (comp[1], comp[2]))
        cur.execute("select count(*) from public.admin_audit_log where entity_type='transition_sync' and entity_id=%s", (tid,))
        expect("Synchronize wrote an audit summary row", cur.fetchone()[0] >= 1, True)
    finally:
        conn.close()
    return state["passed"]


def check_idempotency(migrations, seed) -> bool:
    head("D. Idempotency — re-apply the entire chain on a fresh DB")
    try:
        _, _, cur = build_clean_db(migrations, seed)      # first pass
        cur.execute("select count(*) from public.work_items"); first = cur.fetchone()[0]
        for fn in sorted(migrations):                      # second pass, same DB
            cur.execute(migrations[fn])
        if seed:
            cur.execute(seed)
        cur.execute("select count(*) from public.work_items"); second = cur.fetchone()[0]
    except Exception as e:
        bad(f"re-applying the chain raised: {str(e).splitlines()[0]}"); return False
    if first != second:
        bad(f"work_items changed on re-run: {first} -> {second}"); return False
    ok(f"chain applied twice with no error; work_items stable at {second}")
    return True


def check_parity(zip_path: str, tree: str) -> bool:
    head("E. ZIP <-> working-tree parity")
    z = file_hashes(zip_path)
    t = file_hashes(tree)
    only_zip = sorted(set(z) - set(t))
    only_tree = sorted(set(t) - set(z))
    differ = sorted(k for k in (set(z) & set(t)) if z[k] != t[k])
    good = True
    if only_tree:
        good = False
        for f in only_tree: bad(f"in tree but MISSING from ZIP: {f}")
    if only_zip:
        good = False
        for f in only_zip: bad(f"in ZIP but not in tree: {f}")
    if differ:
        good = False
        for f in differ: bad(f"content differs between ZIP and tree: {f}")
    if good:
        ok(f"{len(z)} files identical in ZIP and tree")
    return good


def check_applied_drift(migrations, applied: list[str] | None, dsn: str | None) -> bool:
    head("F. Applied-history vs repository drift")
    repo = {MIG_RE.match(fn).group(1) for fn in migrations if MIG_RE.match(fn)}
    applied_set: set[str] | None = None
    if dsn:
        try:
            import psycopg2
            c = psycopg2.connect(dsn); c.autocommit = True; cur = c.cursor()
            cur.execute("select version from supabase_migrations.schema_migrations order by version")
            applied_set = {str(r[0])[:4] for r in cur.fetchall()}
        except Exception as e:
            warn(f"could not read applied history from DSN ({str(e).splitlines()[0]}); skipping live check")
    if applied_set is None and applied:
        applied_set = {a.strip()[:4] for a in applied if a.strip()}
    if applied_set is None:
        warn("no applied-version source given (--applied or --applied-dsn); "
             "pass one to detect DB-history/repo drift. Repo migrations: "
             + ", ".join(sorted(repo)))
        return True
    missing_from_repo = sorted(applied_set - repo)   # <-- the 0006 class of bug
    not_yet_applied = sorted(repo - applied_set)
    good = True
    if missing_from_repo:
        good = False
        for v in missing_from_repo:
            bad(f"applied in DB history but MISSING from repo: {v}")
    if not_yet_applied:
        for v in not_yet_applied:
            warn(f"in repo but not yet applied to this DB: {v}")
    if good and not missing_from_repo:
        ok(f"no orphan migrations; applied set is a subset of repo ({len(applied_set)} applied)")
    return good


def check_manifest(zip_path: str, migrations: dict) -> bool:
    head("G. Deployment manifest present & consistent")
    required = ["RELEASE_NOTES.md", "DEPLOYMENT.md", "MIGRATION_ORDER.md",
                "ACCEPTANCE_CHECKLIST.md", "LIFECYCLE.md", "manifest.json"]
    import json
    good = True
    with zipfile.ZipFile(zip_path) as zf:
        root = zip_root(zf)
        names = {n[len(root):] if n.startswith(root) else n for n in zf.namelist()}
        for f in required:
            if f in names:
                ok(f"manifest file present: {f}")
            else:
                bad(f"missing manifest file: {f}"); good = False
        if "manifest.json" not in names:
            return False
        m = json.loads(zf.read(root + "manifest.json").decode("utf-8"))

    for key in ["version", "buildDate", "dbMigrationLevel", "includedMigrations", "expectedExistingMigrations"]:
        if key not in m:
            bad(f"manifest.json missing key: {key}"); good = False
    if not good:
        return False

    level = max(int(k[:4]) for k in migrations)
    if int(m["dbMigrationLevel"]) == level:
        ok(f"dbMigrationLevel matches highest migration ({level:04d})")
    else:
        bad(f"dbMigrationLevel {m['dbMigrationLevel']} != highest migration {level:04d}"); good = False

    covered = sorted(int(x) for x in (list(m["includedMigrations"]) + list(m["expectedExistingMigrations"])))
    if covered == list(range(1, level + 1)):
        ok(f"included + expected migrations cover 0001..{level:04d} with no gaps")
    else:
        bad(f"included + expected do not form a contiguous 0001..{level:04d}: {covered}"); good = False

    incl = {int(x) for x in m["includedMigrations"]}
    present = {int(k[:4]) for k in migrations}
    if incl <= present:
        ok(f"all included migrations are shipped in the package ({sorted(incl)})")
    else:
        bad(f"includedMigrations names files not in the package: {sorted(incl - present)}"); good = False

    STAGES = ["Development", "Internal Validation", "Ready for Acceptance",
              "User Acceptance", "Frozen", "Production Baseline"]
    stage = m.get("lifecycleStage")
    if stage in STAGES:
        ok(f"lifecycle stage declared and valid: {stage}")
    else:
        bad(f"manifest.lifecycleStage missing or invalid: {stage!r} (must be one of {STAGES})"); good = False
    return good


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, help="path to the packaged release ZIP")
    ap.add_argument("--tree", default=None, help="path to the working tree for parity check")
    ap.add_argument("--applied", default=None, help="comma-separated applied versions (e.g. 0001,0002)")
    ap.add_argument("--applied-dsn", default=None, help="DSN to read supabase_migrations.schema_migrations")
    args = ap.parse_args()

    if not os.path.exists(args.zip):
        print(f"{RED}ZIP not found: {args.zip}{RST}"); return 2

    print(f"{DIM}Release check for {args.zip}{RST}")
    migrations = read_zip_migrations(args.zip)
    seed = read_zip_seed(args.zip)

    results = {}
    results["A sequence"] = check_sequence(migrations)

    db = check_clean_rebuild(migrations, seed) if results["A sequence"] else None
    results["B rebuild"] = db is not None

    if db:
        _, _, cur = db
        results["C acceptance"] = check_acceptance(cur)
        results["D idempotency"] = check_idempotency(migrations, seed)
        results["H template vocab"] = check_template_vocab(migrations, seed)
    else:
        results["C acceptance"] = results["D idempotency"] = results["H template vocab"] = False

    results["E parity"] = check_parity(args.zip, args.tree) if args.tree else True
    if not args.tree:
        head("E. ZIP <-> working-tree parity"); warn("no --tree given; skipping parity check")

    results["F drift"] = check_applied_drift(migrations, 
        args.applied.split(",") if args.applied else None, args.applied_dsn)

    results["G manifest"] = check_manifest(args.zip, migrations)

    head("Summary")
    all_ok = True
    for name, val in results.items():
        (ok if val else bad)(name)
        all_ok = all_ok and val
    print()
    if all_ok:
        print(f"{GREEN}INTERNAL VALIDATION PASSED (gate A-H) — package is READY FOR ACCEPTANCE, not yet Accepted/Frozen.{RST}")
        return 0
    print(f"{RED}RELEASE CHECK FAILED — do not ship.{RST}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
