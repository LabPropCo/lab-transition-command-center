# 0012 · Community Director (replaces Portfolio Manager)

## Behavior
- **Portfolio Manager is removed** from the transition model and Settings screen:
  `transitions.portfolio_manager` is dropped, the 0011 Portfolio-Manager default
  trigger is removed, and the audit field list is updated. Portfolio Manager is
  no longer used as a default anywhere.
- **No prior assignment is migrated.** The dropped Portfolio Manager value is not
  carried over. `community_director_id` initializes to **null** on every
  transition, and no name→user matching is attempted (intentional — a free-text
  manager name can't be mapped to a user id reliably). So this is a clean
  replacement, not a data migration; nothing is "preserved."
- **Community Director** is `transitions.community_director_id` — a reference to
  an actual user (`profiles`), not free text. Settings shows a dropdown populated
  from user records (admins read the directory via RLS); when the Users module
  ships it will list active users from the same source.
- **Blank is allowed** (nullable).
- **FK uses `ON DELETE SET NULL`** (confirmed): deleting a user clears the
  assignment instead of blocking the delete or leaving an invalid reference.
- **Audit:** assigning and clearing the Community Director are both audited via
  the transition audit trigger, capturing the prior and new user ids
  (assign: null → id; clear: id → null).

## Display name cache
`community_director_name` stores the selected user's display name so members who
cannot read arbitrary profiles (RLS) can still see who the Community Director is
wherever the leadership team is shown. It is set from the selected user on save.
**Caveat:** it is a cache and **may become stale** if that user later changes
their profile name. See the Phase 3 follow-up below.

## Default ownership (unchanged from 0011)
New transition work items still default their assigned *user* to the authenticated
user only when no explicit assignee exists; the methodology owner *role*
(`responsible_party`) is separate and always preserved. Portfolio Manager is not
used as a default owner role.

## Phase 3 follow-up (not implemented now)
- Populate the Community Director dropdown from the Users module's **active** users.
- Replace/refresh the `community_director_name` cache with a **secure
  display-name lookup** (or keep the cache in sync when a user's profile name
  changes) so leadership displays never show a stale name.
- Admin-configurable default owners by role.
