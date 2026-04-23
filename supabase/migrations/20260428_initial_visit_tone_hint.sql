-- Add tone_hint column to initial_visit_notes
ALTER TABLE initial_visit_notes
  ADD COLUMN tone_hint TEXT;

COMMENT ON COLUMN initial_visit_notes.tone_hint IS
  'Optional provider-entered tone/direction guidance for AI note generation. Applied on full generation, Retry, and section regeneration. Not persisted into finalized PDF.';
