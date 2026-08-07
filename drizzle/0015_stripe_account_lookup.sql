-- RLS forcée sur les tables de facturation, et vue de résolution du webhook.

ALTER TABLE "tuition_plan" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Résolution d'un compte Stripe vers une école, pour le webhook.
--
-- LE PROBLÈME. Depuis la Semaine 1, toute écriture tient son `organization_id`
-- d'une session Clerk vérifiée. Un webhook n'a pas de session : il doit poser
-- un contexte de tenant qu'il ne connaît pas encore. Or lire
-- `organization.stripe_account_id` est soumis à la RLS, laquelle exige
-- justement ce contexte. C'est le même amorçage circulaire qu'en Semaine 1.
--
-- LA RÉPONSE. Cette vue, et elle seule, échappe à la RLS. Elle est
-- délibérément minimale :
--
--   * deux colonnes, toutes deux des identifiants opaques ;
--   * aucune donnée d'école — ni nom, ni fuseau, ni réglage, aucune PII ;
--   * un seul consommateur, le gestionnaire de webhook ;
--   * atteinte uniquement APRÈS une vérification de signature réussie.
--
-- Ce n'est donc pas une brèche mais un point d'entrée authentifié par Stripe :
-- au moment où la vue est lue, la charge utile a déjà prouvé son origine.
--
-- `security_invoker = false` est explicite plutôt que laissé au défaut : ce
-- comportement est le but de la vue, pas un effet de bord dont on hérite.
--
-- `npm run db:verify` vérifie qu'elle n'expose que ces deux colonnes. Sans ce
-- contrôle, le commentaire ci-dessus ne serait qu'une intention.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW "stripe_account_lookup"
  WITH (security_invoker = false) AS
  SELECT "id" AS "organization_id", "stripe_account_id"
  FROM "organization"
  WHERE "stripe_account_id" IS NOT NULL;
