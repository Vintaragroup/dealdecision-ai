-- Migration: Add unique constraint on deal names (case-insensitive)
-- This prevents duplicate deals with the same name from being created

-- First, create a unique index on lowercase name for active deals
-- This allows soft-deleted deals to have the same name as active deals
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_unique_name_active 
ON deals (LOWER(name)) 
WHERE deleted_at IS NULL;

-- Add a comment explaining the constraint
COMMENT ON INDEX idx_deals_unique_name_active IS 
'Ensures each active deal has a unique name (case-insensitive). Soft-deleted deals are excluded from this constraint.';
