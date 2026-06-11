-- Migration: add archived column to masterclasses table
-- Run once on any database created before this column was added.
--
-- Dev (macOS):
--   mariadb -u root cima < db/migrate-add-archived.sql
--
-- Production (Debian, unix-socket auth):
--   sudo mariadb cima < db/migrate-add-archived.sql

ALTER TABLE masterclasses
    ADD COLUMN IF NOT EXISTS archived TINYINT(1) NOT NULL DEFAULT 0;
