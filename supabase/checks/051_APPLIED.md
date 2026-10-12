# Migration 051 (MaalRise core) — production application record

| | |
|---|---|
| Project | Maalgrow-portal, branch `main` (PRODUCTION) |
| Applied | 12 Oct 2026, manually in the Supabase SQL Editor |
| Method | `051_parts/051_part_1_of_6.sql` … `051_part_6_of_6.sql`, in order (byte-identical to `supabase/migrations/051_maalrise_core.sql`; the single-file run did not execute, so nothing was applied twice) |
| Backup | Scheduled daily backup taken the same day, confirmed in Database → Backups before applying |

## Preflight (`maalrise_preflight.sql`)

- `ready_to_apply` = **true**; all 13 required checks true.
- Production level with the repository: 045, 047, 048, 049, 050 live; 046 never applied (as expected).
- No `supabase_migrations.schema_migrations` table (migrations are applied manually).
- Existing-object fingerprint: **`29765b74d899240be77ff2fd6d8d515d`**, **1660** objects.

## Post-apply (`maalrise_postapply.sql`)

- All checks true (`all_ok` = true): 10 tables, 27 functions, RLS on every MaalRise table, read-only policies, guard triggers installed, tables empty.
- Existing-object fingerprint after applying: **`29765b74d899240be77ff2fd6d8d515d`**, **1660** objects — identical, so no MaalGrow object changed.

## Undo

`maalrise_rollback.sql` removes exactly the objects 051 added, and refuses while any MaalRise table holds data.
