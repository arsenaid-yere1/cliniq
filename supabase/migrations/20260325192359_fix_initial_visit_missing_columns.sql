-- Fix initial_visit_notes: add columns lost when 20260309 rebuild ran after ALTER migrations
-- The rebuild migration (20260309194935) sorted after 023/027/029/030 and recreated the table
-- without post_accident_history, time_complexity_attestation, rom_data, and with motor_sensory_reflex

DO $$
BEGIN
  -- Add post_accident_history if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'initial_visit_notes' AND column_name = 'post_accident_history'
  ) THEN
    ALTER TABLE public.initial_visit_notes ADD COLUMN post_accident_history text;
  END IF;

  -- Add time_complexity_attestation if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'initial_visit_notes' AND column_name = 'time_complexity_attestation'
  ) THEN
    ALTER TABLE public.initial_visit_notes ADD COLUMN time_complexity_attestation text;
  END IF;

  -- Add rom_data if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'initial_visit_notes' AND column_name = 'rom_data'
  ) THEN
    ALTER TABLE public.initial_visit_notes ADD COLUMN rom_data jsonb;
  END IF;

  -- Drop motor_sensory_reflex if it still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'initial_visit_notes' AND column_name = 'motor_sensory_reflex'
  ) THEN
    ALTER TABLE public.initial_visit_notes DROP COLUMN motor_sensory_reflex;
  END IF;
END $$;
