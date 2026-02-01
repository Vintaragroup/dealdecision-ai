-- Cleanup Script for Duplicate Deals
-- This script consolidates duplicate deals by:
-- 1. Keeping the oldest deal for each name
-- 2. Moving all documents/data from duplicates to the kept deal
-- 3. Soft-deleting the duplicate deals

-- First, let's see what we're working with
SELECT 
  name, 
  COUNT(*) as count,
  array_agg(id ORDER BY created_at ASC) as deal_ids,
  MIN(created_at) as first_created
FROM deals 
WHERE deleted_at IS NULL
GROUP BY name 
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- For each duplicate group, keep the oldest and mark others as deleted
-- This is a dry-run query - shows what would be deleted
WITH duplicate_deals AS (
  SELECT 
    name,
    id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY LOWER(name) ORDER BY created_at ASC) as rn
  FROM deals
  WHERE deleted_at IS NULL
),
deals_to_delete AS (
  SELECT id, name, created_at
  FROM duplicate_deals
  WHERE rn > 1
)
SELECT 
  d.name,
  d.id as duplicate_id,
  d.created_at as duplicate_created,
  keeper.id as keeper_id,
  keeper.created_at as keeper_created,
  (SELECT COUNT(*) FROM documents WHERE deal_id = d.id) as docs_count
FROM deals_to_delete d
LEFT JOIN duplicate_deals keeper ON LOWER(keeper.name) = LOWER(d.name) AND keeper.rn = 1;

-- UNCOMMENT BELOW TO ACTUALLY PERFORM THE CLEANUP
/*
-- Step 1: Update all foreign key references to point to the keeper deal
WITH duplicate_deals AS (
  SELECT 
    name,
    id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY LOWER(name) ORDER BY created_at ASC) as rn
  FROM deals
  WHERE deleted_at IS NULL
),
deals_to_delete AS (
  SELECT id, name
  FROM duplicate_deals
  WHERE rn > 1
),
keeper_deals AS (
  SELECT id, name
  FROM duplicate_deals
  WHERE rn = 1
)
-- Update documents to point to keeper deal
UPDATE documents
SET deal_id = keeper.id
FROM deals_to_delete dup
JOIN keeper_deals keeper ON LOWER(keeper.name) = LOWER(dup.name)
WHERE documents.deal_id = dup.id;

-- Update other related tables
UPDATE analysis_cycles ac
SET deal_id = keeper.id
FROM deals_to_delete dup
JOIN keeper_deals keeper ON LOWER(keeper.name) = LOWER(dup.name)
WHERE ac.deal_id = dup.id;

UPDATE deal_evidence de
SET deal_id = keeper.id
FROM deals_to_delete dup
JOIN keeper_deals keeper ON LOWER(keeper.name) = LOWER(dup.name)
WHERE de.deal_id = dup.id;

UPDATE deal_intelligence_objects dio
SET deal_id = keeper.id
FROM deals_to_delete dup
JOIN keeper_deals keeper ON LOWER(keeper.name) = LOWER(dup.name)
WHERE dio.deal_id = dup.id;

UPDATE jobs j
SET deal_id = keeper.id
FROM deals_to_delete dup
JOIN keeper_deals keeper ON LOWER(keeper.name) = LOWER(dup.name)
WHERE j.deal_id = dup.id;

-- Step 2: Soft delete the duplicate deals
UPDATE deals
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE id IN (
  SELECT id 
  FROM duplicate_deals 
  WHERE rn > 1
);

-- Step 3: Verify the cleanup
SELECT 
  name, 
  COUNT(*) as count
FROM deals 
WHERE deleted_at IS NULL
GROUP BY name 
HAVING COUNT(*) > 1;
*/
