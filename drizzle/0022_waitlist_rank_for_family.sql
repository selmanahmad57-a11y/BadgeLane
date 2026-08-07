-- Rang du foyer courant dans la liste d'attente d'un cours.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LE MÊME PIÈGE QUE LE DÉCOMPTE — ET PAS TOUT À FAIT.
--
-- Comme les places occupées, le rang est un AGRÉGAT qui exige des lignes hors
-- du foyer : il se classe contre toute la file. Sous contexte famille, le
-- parent ne voit que ses propres inscriptions, et le calcul rendrait « 1 » à
-- tout le monde, en permanence. Un agrégat ne casse pas bruyamment — il rend un
-- nombre plausible, simplement faux.
--
-- Mais il en diffère sur un point qui change la signature de la fonction.
--
-- Le décompte est un agrégat AU NIVEAU DU COURS : « 6 sur 8 » n'appartient à
-- personne, et réimposer la frontière d'école suffit.
--
-- Le rang, lui, est SPÉCIFIQUE À UNE LIGNE — le rang de qui ? Écrite
-- `waitlist_rank(enrollment_id)`, elle laisserait un parent passer
-- l'identifiant d'une autre famille et apprendre « cet enfant-là est 2e ».
-- Petite fuite, même famille que celle qu'on ferme avec un 404.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA PARADE : LA CIBLE VIENT DE LA SESSION, LE CONTEXTE VIENT DE LA REQUÊTE.
--
-- La fonction ne reçoit que le `klass_id` — le contexte, qui n'est pas secret.
-- La cible, elle, est DÉRIVÉE : l'inscription en attente du foyer courant dans
-- ce cours. Aucun identifiant attaquable n'entre.
--
-- C'est la même règle que l'élève du portail en Temps 1 et que l'identifiant
-- client Stripe en Temps 2b : trois surfaces, une seule discipline.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NULL N'EST PAS UN ÉCHEC.
--
-- `NULL` signifie « ce foyer n'a aucune inscription en attente sur ce cours » —
-- une réponse, pas une dérobade. Les vraies impossibilités (hors contexte, hors
-- école) LÈVENT, comme pour le décompte : on ne rend jamais une valeur qui se
-- lirait comme un fait.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "waitlist_rank_for_family"(klass_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  current_org text := current_setting('app.current_org_id', true);
  current_family text := current_setting('app.current_family_id', true);
  owner_org text;
  position integer;
BEGIN
  IF current_org IS NULL OR current_org = '' THEN
    RAISE EXCEPTION 'waitlist_rank_for_family appelee hors contexte d''ecole'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF current_family IS NULL OR current_family = '' THEN
    RAISE EXCEPTION 'waitlist_rank_for_family appelee hors contexte de famille'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT k."organization_id" INTO owner_org
  FROM "klass" k WHERE k."id" = waitlist_rank_for_family.klass_id;

  IF owner_org IS NULL OR owner_org <> current_org THEN
    RAISE EXCEPTION 'cours introuvable dans cette ecole'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  /**
   * La cible est dérivée du foyer courant — jamais reçue. Le classement, lui,
   * se fait contre la file entière, que `security definer` rend visible.
   */
  SELECT rank INTO position FROM (
    SELECT e."id" AS enrollment_id,
           s."family_id" AS owner_family,
           row_number() OVER (ORDER BY e."waitlisted_at" ASC, e."id" ASC) AS rank
    FROM "enrollment" e
    JOIN "student" s ON s."id" = e."student_id"
    WHERE e."klass_id" = waitlist_rank_for_family.klass_id
      AND e."organization_id" = current_org
      AND e."status" = 'waitlisted'
  ) ranked
  WHERE ranked.owner_family::text = current_family
  ORDER BY rank ASC
  LIMIT 1;

  RETURN position;
END;
$$;
