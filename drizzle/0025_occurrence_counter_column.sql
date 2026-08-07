-- Correctif : la colonne de date d'une séance s'appelle `date`, pas `occurs_on`.
--
-- plpgsql ne résout ses références de colonnes qu'à l'EXÉCUTION : la migration
-- précédente s'est appliquée sans broncher, et la fonction aurait échoué au
-- premier appel. Vérifier les noms réels plutôt que les supposer.

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
