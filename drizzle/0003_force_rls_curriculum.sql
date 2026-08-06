-- Force l'application de la RLS sur les tables du curriculum et des lieux.
--
-- Même raison qu'en migration 0001 : Postgres exempte par défaut le
-- propriétaire d'une table de ses propres politiques. Sans `FORCE`, les
-- politiques créées par la migration 0002 resteraient sans effet pour tout rôle
-- propriétaire — c'est précisément le piège qui avait rendu l'isolation
-- décorative lors du premier câblage.
--
-- ⚠️ Toute nouvelle table portant un `organization_id` doit recevoir la même
--    instruction. `npm run db:verify` échoue si l'une d'elles est oubliée.

ALTER TABLE "location" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "level" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill" FORCE ROW LEVEL SECURITY;
