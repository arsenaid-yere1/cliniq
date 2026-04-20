-- Add tone_hint column to procedure_notes
ALTER TABLE procedure_notes
  ADD COLUMN tone_hint TEXT;

COMMENT ON COLUMN procedure_notes.tone_hint IS
  'Optional provider-entered tone/direction guidance for AI note generation. Applied on full generation, Retry, and section regeneration. Not persisted into finalized PDF.';

-- Add tone_hint column to discharge_notes
ALTER TABLE discharge_notes
  ADD COLUMN tone_hint TEXT;

COMMENT ON COLUMN discharge_notes.tone_hint IS
  'Optional provider-entered tone/direction guidance for AI note generation. Applied on full generation, Retry, and section regeneration. Not persisted into finalized PDF.';