-- Extend section-level generation progress to procedure_notes, discharge_notes,
-- and case_summaries. Mirrors the columns + realtime publication added on
-- initial_visit_notes in 20260429.
--
-- sections_total defaults reflect each generator's tool-schema required-key
-- count at time of migration:
--   procedure_notes    = 20 (PROCEDURE_NOTE_TOOL.input_schema.required)
--   discharge_notes    = 12 (DISCHARGE_NOTE_TOOL.input_schema.required)
--   case_summaries     = 7  (SUMMARY_TOOL.input_schema.required)
-- If those schemas change, bump the corresponding *_SECTIONS_TOTAL constant
-- in the generator file; the column default is only the fallback for rows
-- created outside the normal generation path.

ALTER TABLE procedure_notes
  ADD COLUMN sections_done INT NOT NULL DEFAULT 0,
  ADD COLUMN sections_total INT NOT NULL DEFAULT 20;

ALTER TABLE discharge_notes
  ADD COLUMN sections_done INT NOT NULL DEFAULT 0,
  ADD COLUMN sections_total INT NOT NULL DEFAULT 12;

ALTER TABLE case_summaries
  ADD COLUMN sections_done INT NOT NULL DEFAULT 0,
  ADD COLUMN sections_total INT NOT NULL DEFAULT 7;

COMMENT ON COLUMN procedure_notes.sections_done IS
  'Number of top-level tool-input keys Claude has completed during active generation. Driven by Anthropic SDK input_json_delta events, throttled to one write per 500ms.';
COMMENT ON COLUMN procedure_notes.sections_total IS
  'Total required top-level keys in PROCEDURE_NOTE_TOOL input_schema.';
COMMENT ON COLUMN discharge_notes.sections_done IS
  'Number of top-level tool-input keys Claude has completed during active generation. Driven by Anthropic SDK input_json_delta events, throttled to one write per 500ms.';
COMMENT ON COLUMN discharge_notes.sections_total IS
  'Total required top-level keys in DISCHARGE_NOTE_TOOL input_schema.';
COMMENT ON COLUMN case_summaries.sections_done IS
  'Number of top-level tool-input keys Claude has completed during active generation. Driven by Anthropic SDK input_json_delta events, throttled to one write per 500ms.';
COMMENT ON COLUMN case_summaries.sections_total IS
  'Total required top-level keys in SUMMARY_TOOL input_schema.';

ALTER PUBLICATION supabase_realtime ADD TABLE procedure_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE discharge_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE case_summaries;
