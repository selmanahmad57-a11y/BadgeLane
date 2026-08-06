-- Force l'application de la RLS sur la table de présence.
--
-- Même raison qu'aux migrations précédentes : Postgres exempte par défaut le
-- propriétaire d'une table de ses propres politiques.
--
-- L'enjeu est ici comparable à celui des élèves : cette table dit quel enfant
-- était présent, où et quand. Une fuite entre écoles y serait une divulgation
-- de déplacements de mineurs.

ALTER TABLE "attendance" FORCE ROW LEVEL SECURITY;
