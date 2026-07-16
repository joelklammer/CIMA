-- Migrate from num_datasets to start_dataset / end_dataset.
-- Run on any database set up before this schema change:
--
--   sudo mariadb cima < db/migrate-add-dataset-range.sql
--
-- Existing rows receive start_dataset=1 and end_dataset=num_datasets.
-- Update individual masterclasses via the admin Edit button if needed.

ALTER TABLE masterclasses
    ADD COLUMN IF NOT EXISTS start_dataset INT NOT NULL DEFAULT 1 AFTER event_date,
    ADD COLUMN IF NOT EXISTS end_dataset   INT NOT NULL DEFAULT 1 AFTER start_dataset;

-- Populate end_dataset from num_datasets (start stays 1)
UPDATE masterclasses
SET end_dataset = num_datasets
WHERE num_datasets IS NOT NULL;

-- Drop the old column
ALTER TABLE masterclasses
    DROP COLUMN IF EXISTS num_datasets;
