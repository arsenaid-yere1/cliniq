update public.service_catalog
set cpt_code = upper(trim(cpt_code))
where cpt_code <> upper(trim(cpt_code));
