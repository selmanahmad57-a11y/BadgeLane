-- Force l'application de la RLS au rôle propriétaire des tables.
--
-- Pourquoi c'est indispensable : sur Neon, l'application se connecte avec le
-- rôle qui a créé les tables. Or Postgres exempte par défaut le propriétaire
-- d'une table de ses propres politiques RLS. Sans les instructions ci-dessous,
-- `ENABLE ROW LEVEL SECURITY` (posé par la migration 0000) serait donc
-- silencieusement sans effet pour l'application : chaque école verrait les
-- données de toutes les autres.
--
-- `FORCE ROW LEVEL SECURITY` supprime cette exemption. Drizzle ne sait pas
-- l'exprimer dans le schéma TypeScript, d'où cette migration écrite à la main.
--
-- ⚠️ Toute nouvelle table portant un `organization_id` doit recevoir la même
--    instruction. `npm run db:verify` échoue si l'une d'elles est oubliée.

ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_user" FORCE ROW LEVEL SECURITY;
