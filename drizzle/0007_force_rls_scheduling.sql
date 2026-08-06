-- Force l'application de la RLS sur les tables du planning.
--
-- Même raison qu'aux migrations 0001, 0003 et 0005 : Postgres exempte par
-- défaut le propriétaire d'une table de ses propres politiques.
--
-- `class_occurrence` portera bientôt la présence (Semaine 6) : une fuite entre
-- écoles y révélerait quel enfant était présent où et quand.
--
-- ⚠️ Toute nouvelle table portant un `organization_id` doit recevoir la même
--    instruction. `npm run db:verify` échoue si l'une d'elles est oubliée.

ALTER TABLE "term" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "klass" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_occurrence" FORCE ROW LEVEL SECURITY;
