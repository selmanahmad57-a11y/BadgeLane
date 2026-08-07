-- Second axe d'autorisation : la famille (Semaine 10).
--
-- Jusqu'ici une seule question décidait de tout : « de quelle école s'agit-il ? ».
-- Le portail parent en ajoute une seconde : « de quelle famille s'agit-il ? ».
--
-- L'ajout est volontairement ADDITIF. Chaque prédicat commence par tester
-- l'absence de contexte famille ; les neuf semaines de code existant ne posent
-- jamais ce paramètre, donc leur prédicat reste littéralement identique. Un
-- ajout qui ne peut pas régresser ce qui marchait.
--
-- Quatre formes, selon la catégorie déclarée dans `src/config/access.ts` :
--
--   * catalogue de l'école  — inchangé, le parent lit l'offre commune
--   * portée famille        — restreint par `family_id` (ou `id` pour `family`)
--   * via l'élève           — restreint par sous-requête sur `student`
--   * plomberie             — zéro ligne dès qu'un contexte famille existe
--
-- La comparaison se fait EN TEXTE des deux côtés. Convertir le paramètre en
-- `uuid` ferait ÉCHOUER la requête — et non renvoyer zéro ligne — si la valeur
-- n'était pas un identifiant valide. Une politique de sécurité doit refuser,
-- pas planter.

ALTER TABLE "stripe_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "stripe_event_tenant_isolation" ON "stripe_event" AS PERMISSIVE FOR ALL TO public USING (coalesce(current_setting('app.current_family_id', true), '') = '') WITH CHECK (coalesce(current_setting('app.current_family_id', true), '') = '');--> statement-breakpoint
ALTER POLICY "attendance_tenant_isolation" ON "attendance" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    ))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    )));--> statement-breakpoint
ALTER POLICY "enrollment_tenant_isolation" ON "enrollment" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    ))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    )));--> statement-breakpoint
ALTER POLICY "family_tenant_isolation" ON "family" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or id::text = current_setting('app.current_family_id', true))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or id::text = current_setting('app.current_family_id', true)));--> statement-breakpoint
ALTER POLICY "guardian_tenant_isolation" ON "guardian" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true)));--> statement-breakpoint
ALTER POLICY "invoice_tenant_isolation" ON "invoice" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true)));--> statement-breakpoint
ALTER POLICY "skill_progress_tenant_isolation" ON "skill_progress" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    ))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    )));--> statement-breakpoint
ALTER POLICY "staff_user_tenant_isolation" ON "staff_user" TO public USING (organization_id = current_setting('app.current_org_id', true) and coalesce(current_setting('app.current_family_id', true), '') = '') WITH CHECK (organization_id = current_setting('app.current_org_id', true) and coalesce(current_setting('app.current_family_id', true), '') = '');--> statement-breakpoint
ALTER POLICY "student_tenant_isolation" ON "student" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true)));--> statement-breakpoint
ALTER POLICY "subscription_tenant_isolation" ON "subscription" TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or family_id::text = current_setting('app.current_family_id', true)));--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- `stripe_event` : la RLS n'y était même pas activée.
--
-- Défendable tant que seul le personnel se connectait — la table ne porte que
-- des identifiants d'événements Stripe. Le portail parent change la donne :
-- « un parent n'a rien à voir de la plomberie de facturation » doit être une
-- règle de la base, pas une conséquence du fait qu'aucune requête ne la lit.
--
-- `FORCE` en plus d'`ENABLE` : sans lui, le propriétaire de la table échapperait
-- à sa propre politique, exactement comme en Semaine 1.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "stripe_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Résolution d'un parent par son adresse e-mail.
--
-- Le lien entre un compte Clerk et un `guardian` n'est jamais stocké : il se
-- dérive à chaque requête de l'adresse VÉRIFIÉE du compte. Corriger une faute
-- de frappe dans `guardian.email` transfère donc l'accès, au lieu de laisser
-- l'ancien titulaire connecté — ce qu'un `clerk_user_id` stocké ferait.
--
-- Le prix de cette dérivation est une recherche par requête : d'où cet index.
-- En minuscules, parce que les adresses ne sont pas sensibles à la casse et que
-- l'école les saisit à la main.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX "guardian_email_lower_idx" ON "guardian" (lower("email"));
