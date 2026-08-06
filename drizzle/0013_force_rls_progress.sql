-- Force l'application de la RLS sur la progression.
--
-- Même raison qu'aux migrations précédentes : Postgres exempte par défaut le
-- propriétaire d'une table de ses propres politiques.
--
-- Cette table dit ce que chaque enfant sait faire dans l'eau. Une fuite entre
-- écoles y révélerait le niveau réel d'élèves qui ne sont pas les vôtres.

ALTER TABLE "skill_progress" FORCE ROW LEVEL SECURITY;
