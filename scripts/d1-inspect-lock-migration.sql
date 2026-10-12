-- Read-only inspection before reconciling the renamed locking migration.
SELECT id, name, applied_at FROM d1_migrations ORDER BY id;
PRAGMA table_info('links');
PRAGMA table_info('link_audit');
SELECT name, tbl_name, sql
FROM sqlite_master
WHERE name IN ('link_audit', 'link_audit_slug_created_at_desc_idx', 'link_audit_created_at_desc_idx');

-- Compare these totals before and after the history-only repair.
SELECT COUNT(*) AS links, SUM(CASE WHEN locked = 1 THEN 1 ELSE 0 END) AS locked_links FROM links;
SELECT COUNT(*) AS audit_entries FROM link_audit;
