-- Undo only the history rename performed by d1-reconcile-lock-migration.sql.
-- Use only after verifying the pre-repair record had the old filename.
-- Do not use on a fresh database that originally applied migration 0006.
UPDATE d1_migrations
SET name = '0005_living_ultimo.sql'
WHERE name = '0006_living_ultimo.sql'
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0005_living_ultimo.sql')
  AND EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0005_tan_karma.sql')
  AND EXISTS (SELECT 1 FROM pragma_table_info('links') WHERE name = 'locked' AND type = 'INTEGER')
  AND EXISTS (SELECT 1 FROM pragma_table_info('links') WHERE name = 'proxy' AND type = 'INTEGER')
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'link_audit');

SELECT changes() AS rolled_back_rows;
SELECT id, name, applied_at FROM d1_migrations
WHERE name IN ('0005_living_ultimo.sql', '0005_tan_karma.sql', '0006_living_ultimo.sql')
ORDER BY id;
