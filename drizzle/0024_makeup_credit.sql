-- Crédits de rattrapage, et le compteur au niveau de la SÉANCE.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI `count_seats_taken` NE CONVIENT PAS ICI.
--
-- Le compteur de la Semaine 10 travaille au niveau du COURS : une classe de 8
-- accepte 8 inscrits actifs. Un rattrapage n'ajoute personne au cours — il
-- ajoute un corps de plus à UNE SEULE séance.
--
-- Réutiliser le compteur de classe laisserait donc passer un neuvième enfant
-- dans un bassin de huit, et silencieusement : la classe, elle, resterait à
-- 8/8. Le décompte qui compte est celui de l'occurrence :
--
--     roster de cette date  +  rattrapages réservés sur cette séance  <  capacité
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LE ROSTER EST CELUI DE LA SEMAINE 6, PAS UNE RÉÉCRITURE.
--
-- « Qui figure sur la feuille de cette séance » a déjà une définition :
-- inscrit avant cette date, pas encore parti, et pas en liste d'attente. La
-- recopier ici en créerait une seconde, et les deux divergeraient au premier
-- changement. Les statuts exclus arrivent donc en ARGUMENT, depuis
-- `ROSTER_EXCLUDED_STATUSES`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MÊMES GARDES QUE LE COMPTEUR DE CLASSE.
--
-- `security definer` — sous contexte famille, `enrollment` et `makeup_credit`
-- sont restreints aux enfants du foyer : un parent compterait un bassin vide.
--
-- Frontière d'école réimposée à la main : l'identifiant d'occurrence vient d'un
-- formulaire, donc d'un attaquant possible. Sans garde, on lirait l'occupation
-- d'une séance de n'importe quelle école.
--
-- Et surtout : JAMAIS 0 À TORT. Hors contexte ou hors école, la fonction LÈVE.
-- Un zéro rendu par erreur se lirait « la séance est vide », donc « il reste de
-- la place » — le surbooking même qu'on ferme.
--
-- Elle s'exécute dans la transaction de l'appelant, donc sous le verrou pris
-- sur la ligne `class_occurrence` — pas sur `klass` : deux rattrapages dans
-- deux séances du même cours n'ont aucune raison de s'attendre.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."makeup_credit_status" AS ENUM('available', 'booked', 'used');--> statement-breakpoint
CREATE TABLE "makeup_credit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"missed_occurrence_id" uuid NOT NULL,
	"booked_occurrence_id" uuid,
	"status" "makeup_credit_status" DEFAULT 'available' NOT NULL,
	"extended_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "makeup_credit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD CONSTRAINT "makeup_credit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD CONSTRAINT "makeup_credit_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD CONSTRAINT "makeup_credit_missed_occurrence_id_class_occurrence_id_fk" FOREIGN KEY ("missed_occurrence_id") REFERENCES "public"."class_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD CONSTRAINT "makeup_credit_booked_occurrence_id_class_occurrence_id_fk" FOREIGN KEY ("booked_occurrence_id") REFERENCES "public"."class_occurrence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_credit_absence_key" ON "makeup_credit" USING btree ("organization_id","student_id","missed_occurrence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "makeup_credit_one_seat_per_occurrence" ON "makeup_credit" USING btree ("organization_id","booked_occurrence_id","student_id") WHERE booked_occurrence_id is not null;--> statement-breakpoint
CREATE INDEX "makeup_credit_organization_id_idx" ON "makeup_credit" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "makeup_credit_booked_occurrence_idx" ON "makeup_credit" USING btree ("booked_occurrence_id");--> statement-breakpoint
CREATE POLICY "makeup_credit_tenant_isolation" ON "makeup_credit" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    ))) WITH CHECK (organization_id = current_setting('app.current_org_id', true)
    and (coalesce(current_setting('app.current_family_id', true), '') = '' or student_id in (
      select "id" from "student" where "family_id"::text = current_setting('app.current_family_id', true)
    )));--> statement-breakpoint

CREATE OR REPLACE FUNCTION "count_occurrence_attendees"(
  occurrence_id uuid,
  roster_excluded_statuses text[],
  makeup_occupying_statuses text[]
)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  current_org text := current_setting('app.current_org_id', true);
  target record;
  attendees integer;
BEGIN
  IF current_org IS NULL OR current_org = '' THEN
    RAISE EXCEPTION 'count_occurrence_attendees appelee hors contexte d''ecole'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o."organization_id" AS org, o."klass_id" AS klass_id, o."date" AS occurs_on
    INTO target
  FROM "class_occurrence" o
  WHERE o."id" = count_occurrence_attendees.occurrence_id;

  IF target IS NULL OR target.org <> current_org THEN
    RAISE EXCEPTION 'seance introuvable dans cette ecole'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT
    (
      SELECT count(*)
      FROM "enrollment" e
      WHERE e."organization_id" = current_org
        AND e."klass_id" = target.klass_id
        AND NOT (e."status"::text = ANY (roster_excluded_statuses))
        AND e."start_date" <= target.occurs_on
        AND (e."end_date" IS NULL OR e."end_date" >= target.occurs_on)
    )
    +
    (
      SELECT count(*)
      FROM "makeup_credit" m
      WHERE m."organization_id" = current_org
        AND m."booked_occurrence_id" = count_occurrence_attendees.occurrence_id
        AND m."status"::text = ANY (makeup_occupying_statuses)
    )
  INTO attendees;

  RETURN attendees::integer;
END;
$$;
