-- Add section-level generation progress columns to initial_visit_notes, and
-- enable Supabase Realtime on the table so the client editor can subscribe to
-- row updates without polling.
--
-- sections_total = 16 reflects the count of required top-level keys in the
-- Anthropic tool schema used by generate-initial-visit.ts (INITIAL_VISIT_TOOL
-- input_schema.required). If that schema grows or shrinks, update this default.

ALTER TABLE initial_visit_notes
  ADD COLUMN sections_done INT NOT NULL DEFAULT 0,
  ADD COLUMN sections_total INT NOT NULL DEFAULT 16;

COMMENT ON COLUMN initial_visit_notes.sections_done IS
  'Number of top-level tool-input keys Claude has completed during the active generation. Incremented by the server action as the Anthropic SDK streams input_json_delta events. Reset to 0 when a new generation is started.';

COMMENT ON COLUMN initial_visit_notes.sections_total IS
  'Total number of required top-level keys in the generation tool schema. Matches INITIAL_VISIT_TOOL.input_schema.required length in generate-initial-visit.ts.';

ALTER PUBLICATION supabase_realtime ADD TABLE initial_visit_notes;
