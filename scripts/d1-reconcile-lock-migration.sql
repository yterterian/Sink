-- The merge renamed an already applied migration without changing its SQL.
-- Preserve the original migration ID and applied_at; change only its filename.
-- Missing history or schema leaves the row untouched and requires investigation.
UPDATE d1_migrations
SET name = '0006_living_ultimo.sql'
WHERE name = '0005_living_ultimo.sql'
  AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0006_living_ultimo.sql')
  AND EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0005_tan_karma.sql')
  AND EXISTS (SELECT 1 FROM pragma_table_info('links') WHERE name = 'locked' AND type = 'INTEGER')
  AND EXISTS (SELECT 1 FROM pragma_table_info('links') WHERE name = 'proxy' AND type = 'INTEGER')
  AND (SELECT COUNT(*) FROM pragma_table_info('link_audit')) = 11
  AND (SELECT COUNT(*) FROM pragma_table_info('link_audit') WHERE
    (name = 'id' AND type = 'TEXT' AND pk = 1 AND "notnull" = 1)
    OR (name IN ('slug', 'action', 'actor', 'changes') AND type = 'TEXT' AND "notnull" = 1)
    OR (name IN ('link_id', 'auth_method', 'ip', 'country', 'reason') AND type = 'TEXT' AND "notnull" = 0)
    OR (name = 'created_at' AND type = 'INTEGER' AND "notnull" = 1)) = 11
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = 'link_audit'
    AND name IN ('link_audit_slug_created_at_desc_idx', 'link_audit_created_at_desc_idx')) = 2;

SELECT changes() AS reconciled_rows;
SELECT id, name, applied_at FROM d1_migrations
WHERE name IN ('0005_living_ultimo.sql', '0005_tan_karma.sql', '0006_living_ultimo.sql')
ORDER BY id;
