DELETE FROM integration_sessions
WHERE source_system IS NULL OR TRIM(source_system) = '';

ALTER TABLE integration_sessions
  MODIFY source_system VARCHAR(255) NOT NULL;
