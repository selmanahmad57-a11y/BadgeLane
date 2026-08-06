-- Force l'application de la RLS sur les tables familles, tuteurs et élèves.
--
-- Même raison qu'aux migrations 0001 et 0003 : Postgres exempte par défaut le
-- propriétaire d'une table de ses propres politiques. Sans `FORCE`, celles
-- créées par la migration 0004 resteraient sans effet.
--
-- L'enjeu est ici le plus élevé du schéma : ces tables portent des noms
-- d'enfants, des dates de naissance et des notes de santé. Une fuite entre
-- écoles n'y serait pas un incident technique mais une violation de données
-- personnelles concernant des mineurs.
--
-- ⚠️ Toute nouvelle table portant un `organization_id` doit recevoir la même
--    instruction. `npm run db:verify` échoue si l'une d'elles est oubliée.

ALTER TABLE "family" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guardian" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "student" FORCE ROW LEVEL SECURITY;
