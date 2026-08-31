-- 012 — Export Winbiz : archive du fichier émis dans winbiz_exports
-- (page comptabilité : « Télécharger » renvoie EXACTEMENT les octets déposés,
-- même si la commande a changé depuis ou si le fichier a quitté le Drive).
--
-- À exécuter dans le SQL Editor Supabase (projet llkyzspixrbtoprtmvoh),
-- jamais via PowerShell. Idempotent.
--
-- contenu_base64 : le fichier cp1252 encodé en base64 (~10 Ko par export).
-- contenu_taille : colonne générée, permet à la liste de savoir si l'archive
--                  existe sans rapatrier le contenu (les exports antérieurs à
--                  cette migration n'en ont pas).

alter table public.winbiz_exports
  add column if not exists contenu_base64 text;

alter table public.winbiz_exports
  add column if not exists contenu_taille int
    generated always as (length(contenu_base64)) stored;

comment on column public.winbiz_exports.contenu_base64 is
  'Fichier bizexdoc émis (cp1252, base64) — archive fidèle, sha256 dans contenu_hash';

-- Contrôle (doc 04 §12 : un SELECT après toute écriture)
select id, numero_commande, version, filename, contenu_taille
from public.winbiz_exports
order by id desc
limit 5;
