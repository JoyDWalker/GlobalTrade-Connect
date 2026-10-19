-- Los países grandes (España, EE. UU., Suiza…) agotaban el tiempo del servicio oficial de Wikidata y quedaron
-- marcados como terminados tras 3 fallos. Ahora la importación usa QLever (mismos datos, mucho más rápido):
-- se reactivan para continuar donde se quedaron.
UPDATE import_cursors SET done = false, failures = 0, last_error = NULL WHERE last_error IS NOT NULL;
