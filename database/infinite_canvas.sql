-- Infinite Canvas MySQL schema
-- Compatible with MySQL 8.0+
-- Run this script with a MySQL account that can create databases and tables.

CREATE DATABASE IF NOT EXISTS infinite_canvas
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE infinite_canvas;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_documents (
  namespace VARCHAR(128) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  record_key VARCHAR(512) NOT NULL,
  payload JSON NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (namespace, domain, record_key),
  KEY idx_storage_documents_updated_at (namespace, domain, updated_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_blobs (
  namespace VARCHAR(128) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  content LONGBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (namespace, storage_key),
  KEY idx_storage_blobs_updated_at (namespace, updated_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- The application inserts this record automatically at startup. Keeping it
-- here makes the manually initialized database match the built-in migration.
INSERT IGNORE INTO schema_migrations (version) VALUES ('001_init');
