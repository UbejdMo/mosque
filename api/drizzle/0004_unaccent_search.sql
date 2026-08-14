-- Albanian diacritics must not defeat the collector's search (SPEC §10):
-- typing `Berisha` has to find `Bërisha`, and `Krasniqi` has to find `Krasniqi`
-- however it was typed into the notebook.
--
-- `unaccent` is available on Supabase as well, so this works in both places.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint

-- `unaccent()` is STABLE, not IMMUTABLE, so it cannot appear in an index
-- directly. This wrapper pins the dictionary and is safe to mark IMMUTABLE.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
--> statement-breakpoint

-- ~2,500 people is far too small for this to matter, but the collector types
-- into this box constantly and it costs nothing to make it instant.
CREATE INDEX persons_name_search_idx
  ON persons (immutable_unaccent(lower(first_name || ' ' || father_name || ' ' || last_name)));
--> statement-breakpoint

CREATE INDEX households_neighbourhood_search_idx
  ON households (immutable_unaccent(lower(coalesce(neighbourhood, ''))));
