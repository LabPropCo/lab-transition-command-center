# 0011 · Intelligent default ownership

Additive; applies on creation only and never overwrites an existing assignment.

- **New transition → Portfolio Manager defaults to the creator.** A `BEFORE
  INSERT` trigger sets `transitions.portfolio_manager` to the authenticated
  user's name (or email) only when it is left blank. An explicitly provided
  Portfolio Manager is preserved; a transition created without an auth context
  (e.g. seed) stays blank.
- **Sync-added work items default the assigned user to the creator.**
  Instantiation now sets `owner = coalesce(template.default_owner,
  current_user_display())`. If the methodology names an owner it is kept; only
  genuinely unassigned items fall to the authenticated user. The owner **role**
  (`responsible_party`) is always taken from the methodology and never changed.
- **Only on initial creation.** Instantiation inserts only items that don't yet
  exist, so re-synchronizing never overwrites an owner set by hand or earlier.
- **Always editable.** Owner and role remain editable per work item as before.

Helper: `current_user_display()` returns the current user's `full_name` or
`email`, or null when there is no auth context.

Future (not implemented): admin-configurable default owners by role
(Portfolio Manager, Regional Manager, Transition Coordinator, …) so assignments
can be automated per role without manual changes after each new transition.
