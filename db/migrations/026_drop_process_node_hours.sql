-- F3 (brooks-audit): drop empty process_node_hours table
-- Reason: 0 rows, no service references it (duplicate concept with process_standard_hours)
DROP TABLE IF EXISTS process_node_hours;
