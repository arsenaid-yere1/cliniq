-- Keep the application-owned decision closing in the education paragraph.
-- btrim(text) only removed spaces, so each saved closing accumulated newlines.
-- Modify future draft writes only; do not backfill or rewrite signed notes.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.guard_visit_decision()'::regprocedure);
 if position($old$btrim(replace(new.patient_education,previous,''))$old$ in definition)=0 then raise exception 'Visit decision spacing anchor 1 not found'; end if;
 definition:=replace(definition,$old$btrim(replace(new.patient_education,previous,''))$old$,$new$btrim(replace(new.patient_education,previous,''),E' \t\r\n')$new$);
 if position($old$btrim(replace(new.patient_education,closing,''))$old$ in definition)=0 then raise exception 'Visit decision spacing anchor 2 not found'; end if;
 definition:=replace(definition,$old$btrim(replace(new.patient_education,closing,''))$old$,$new$btrim(replace(new.patient_education,closing,''),E' \t\r\n')$new$);
 if position($old$concat_ws(E'\n\n',nullif(new.patient_education,''),closing)$old$ in definition)=0 then raise exception 'Visit decision spacing anchor 3 not found'; end if;
 definition:=replace(definition,$old$concat_ws(E'\n\n',nullif(new.patient_education,''),closing)$old$,$new$concat_ws(' ',nullif(btrim(new.patient_education,E' \t\r\n'),''),closing)$new$);
 execute definition;
end $migration$;
