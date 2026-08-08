-- Registre des e-mails sortants — le `stripe_event` de l'envoi.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE LA CONTRAINTE FERME, ET CE QU'ELLE NE PEUT PAS FERMER.
--
-- L'unicité (école, nature, sujet, période) rend impossible de TENTER deux fois
-- le même envoi : un déclenchement concurrent tombe sur une violation de
-- contrainte, jamais sur un second courriel.
--
-- Mais le motif du webhook — « insérer l'événement et écrire le miroir dans une
-- seule transaction » — ne se transpose PAS ici. Là-bas, les deux côtés étaient
-- la base, et la transaction les atomisait vraiment. Ici l'un des deux est un
-- appel HTTP, que Postgres ne peut pas envelopper.
--
-- Si l'envoi RÉUSSIT et que le processus meurt avant le commit, la ligne est
-- annulée et l'e-mail est parti quand même : le passage suivant le renverrait.
-- Aucune transaction ne ferme cette fenêtre, parce que l'action irréversible
-- vit dehors.
--
-- D'où la séquence, dont l'ordre porte la garantie :
--
--   1. réclamer la ligne, et VALIDER — la contrainte arrête les concurrents ;
--   2. envoyer HORS transaction, en passant cette même clé au fournisseur comme
--      clé d'idempotence — c'est là que se ferme l'unique fenêtre restante ;
--   3. marquer le résultat.
--
-- Deux mécanismes, parce qu'un côté est externe. La dedup se fait là où
-- l'action irréversible se fait.
--
-- `period` vaut la chaîne vide plutôt que NULL pour un transactionnel : une
-- contrainte d'unicité ignore les NULL, et deux confirmations pour la même
-- facture passeraient toutes les deux.

CREATE TYPE "public"."email_delivery_status" AS ENUM('claimed', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('payment_confirmation', 'monthly_progress');--> statement-breakpoint
CREATE TABLE "outbound_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "email_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"status" "email_delivery_status" DEFAULT 'claimed' NOT NULL,
	"recipient" text NOT NULL,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_email" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbound_email" ADD CONSTRAINT "outbound_email_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_email_claim_key" ON "outbound_email" USING btree ("organization_id","kind","subject_id","period");--> statement-breakpoint
CREATE POLICY "outbound_email_tenant_isolation" ON "outbound_email" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true) and coalesce(current_setting('app.current_family_id', true), '') = '') WITH CHECK (organization_id = current_setting('app.current_org_id', true) and coalesce(current_setting('app.current_family_id', true), '') = '');--> statement-breakpoint
ALTER TABLE "outbound_email" FORCE ROW LEVEL SECURITY;
