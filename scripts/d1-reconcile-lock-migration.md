# Reconcile the renamed locking migration

The upstream merge renamed `0005_living_ultimo.sql` to `0006_living_ultimo.sql` without changing its SQL. Databases that already applied the old filename have the locking schema, but Wrangler attempts to apply it again under the new filename. The October 12 deployment applied `0005_tan_karma.sql` successfully and then stopped because `link_audit` already existed. The Worker publishing command did not run.

## Save a recovery baseline

The live short codes must keep their existing slugs, destinations, passwords, and lock state. The repair changes one filename in `d1_migrations`; the rollback reverses that filename change. Neither operation changes link rows, audit rows, indexes, or KV cache entries. Leave the successfully added `proxy` column in place when rolling back; the previous Worker can continue using the existing schema.

Before any repair or deployment, use the existing authenticated deployment environment to save a D1 export and the current Worker deployment details. These commands use PowerShell and put private recovery artefacts in the gitignored `.wrangler/recovery/` directory:

```powershell
pnpm deploy:config
$recoveryDir = Join-Path '.wrangler/recovery' (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $recoveryDir -Force | Out-Null
pnpm exec wrangler deployments list --config wrangler.deploy.jsonc --json | Out-File -LiteralPath (Join-Path $recoveryDir 'worker-deployments.json') -Encoding utf8
pnpm exec wrangler d1 export DB --remote --config wrangler.deploy.jsonc --output (Join-Path $recoveryDir 'd1-before-reconciliation.sql')
pnpm exec wrangler d1 execute DB --remote --config wrangler.deploy.jsonc --file scripts/d1-inspect-lock-migration.sql --json | Out-File -LiteralPath (Join-Path $recoveryDir 'd1-before-reconciliation.json') -Encoding utf8
```

Check that every command succeeded and that the export and JSON files are non-empty and complete. Record the exact currently serving Worker **version ID**, its deployment percentages, the public hostname, and several known live short-code destinations. A deployment ID is not a version ID. Copy the recovery files to secure storage outside this checkout; the database export contains private link data. Schedule the export for a quiet period because D1 exports can temporarily block database writes.

Do not proceed unless the export is available and the previous serving version is identified. If the Worker currently uses a split deployment, preserve the complete version distribution and use Cloudflare's deployment controls to restore that distribution instead of the single-version rollback command below.

Use the existing deployment environment to inspect the target database:

```sh
pnpm deploy:config
pnpm exec wrangler d1 execute DB --remote --config wrangler.deploy.jsonc --file scripts/d1-inspect-lock-migration.sql
```

Confirm the database ID is the intended production target. The failed deployment targeted `7fceb607-8e10-466b-ac62-83821d0f6f8d`. Verify that migration history contains `0005_living_ultimo.sql` and `0005_tan_karma.sql`, that `links` has both `locked` and `proxy`, and that the audit table and its two indexes match `drizzle/0006_living_ultimo.sql`.

If these checks match, reconcile the migration filename:

```sh
pnpm exec wrangler d1 execute DB --remote --config wrangler.deploy.jsonc --file scripts/d1-reconcile-lock-migration.sql
```

The repair updates only the migration-history filename and preserves its ID and application timestamp. It does not change link or audit data. Expect `reconciled_rows = 1`, with `0006_living_ultimo.sql` replacing the old filename. If it reports zero and the new filename is absent, stop and investigate the history or schema mismatch. If the new filename already exists with the expected schema, the repair has already been completed.

Rerun the deployment after reconciliation. Wrangler should report no pending migrations before publishing the Worker. Fresh databases continue to apply migrations 0005 and 0006 normally; do not change their SQL to hide existing-schema errors.

## Verify live codes

Run the inspection query again after the history repair. Compare the migration ID and application timestamp with the saved baseline and confirm link, locked-link, and audit totals remain consistent with normal traffic. Before and after Worker publishing, check the recorded live codes with redirects disabled and compare their status and `Location` header with the baseline. Include a normal link, a locked link, and any password-protected or geo/app-routed links in use. Password-protected links must retain their protection; geo/app routes need the same headers and client conditions for a valid comparison. Confirm the dashboard can read existing links and history. Do not test deletion or slug reuse against real printed codes.

## Roll back without discarding live data

If the newly published Worker breaks live redirects, first restore the saved serving version directly. Do not use `pnpm deploy:worker` to roll back, because it runs migrations before publishing:

```powershell
pnpm exec wrangler rollback SAVED_WORKER_VERSION_ID --config wrangler.deploy.jsonc --message "Restore live short-code behaviour after upstream merge"
```

Replace `SAVED_WORKER_VERSION_ID` with the exact version captured before publishing. Verify the deployment and the same live-code checks immediately. Worker rollback does not restore D1 or KV data, so links created or edited since the baseline remain available. Retain the repaired migration history if the schema is correct; Worker rollback alone does not require undoing the filename repair.

If the history repair itself needs to be undone, use the separate guarded rollback SQL **only on the legacy database whose saved baseline contains `0005_living_ultimo.sql`**:

```powershell
pnpm exec wrangler d1 execute DB --remote --config wrangler.deploy.jsonc --file scripts/d1-rollback-lock-reconciliation.sql
pnpm exec wrangler d1 execute DB --remote --config wrangler.deploy.jsonc --file scripts/d1-inspect-lock-migration.sql
```

Expect `rolled_back_rows = 1` on the first rollback and zero on a repeat. Confirm the original history filename, ID, and timestamp match the baseline, and verify live codes again. The current checkout's automatic migration command will fail again after this history rollback; stop automated redeploys until the history is reconciled again. Never apply this rollback to a fresh database that originally applied migration 0006.

The full D1 export is an emergency recovery artefact, not the routine rollback. Do not import it over the live database: that could overwrite links created or edited after the export. If actual data recovery becomes necessary, restore into a separate recovery database first, compare the affected rows, and plan a selective recovery. Preserve the live database and its current KV cache while investigating.
