-- Add event_date column to masterclasses.
-- Run this on any database that was set up before the date-organized branch.
--
--   sudo mariadb cima < db/migrate-add-date.sql
--
-- Existing rows receive today's date as a placeholder; update them via the
-- admin page after running the migration.

ALTER TABLE masterclasses
    ADD COLUMN IF NOT EXISTS event_date DATE NOT NULL DEFAULT (CURDATE()) AFTER name;
