-- Décompte des places occupées d'un cours, hors RLS famille.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LE PIÈGE QU'ELLE FERME — un surbooking parfaitement silencieux.
--
-- Depuis la Semaine 10, `enrollment` est restreinte aux enfants du foyer
-- courant. Un parent qui s'inscrit compterait donc les places occupées… de sa
-- propre famille : zéro, presque toujours. Tout cours paraîtrait vide, et
-- chaque parent entrerait dans un bassin complet.
--
-- Aucune erreur, aucun log, aucun test existant : `enrollment:verify` éprouve
-- le verrou en contexte PERSONNEL, où le décompte est juste. La barrière fait
-- son travail, et c'est précisément ça le problème.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QU'IL FAUT REMETTRE À LA MAIN.
--
-- `security definer` retire la RLS : les deux garanties qu'elle offrait
-- doivent être réécrites ici, explicitement.
--
-- 1. LA FRONTIÈRE D'ÉCOLE. Contrairement à `resolve_guardian_families`, qui se
--    borne toute seule en partant d'une adresse vérifiée, celle-ci reçoit un
--    `klass_id` venu d'un formulaire — donc contrôlé par l'appelant. Sans
--    garde, on passe l'identifiant d'un cours d'une AUTRE école et l'on obtient
--    son effectif : un oracle d'occupation inter-tenant. L'insertion suivante
--    échouerait, certes — mais le compte aurait déjà fuité.
--
-- 2. NE JAMAIS RENDRE 0 À TORT. C'est le durcissement qui compte le plus. Un
--    `where` qui ne matche pas rendrait « aucune place occupée », donc
--    « il reste de la place ». Une garde silencieuse produirait exactement le
--    surbooking qu'on ferme. Hors contexte, ou hors école, la fonction LÈVE.
--    Zéro doit vouloir dire « ce cours est vide », jamais « je n'ai pas pu
--    regarder ».
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI CE N'EST PAS UNE CONCESSION.
--
-- Elle ne rend qu'un entier — aucune ligne, aucune donnée personnelle — et
-- c'est un nombre que le portail affiche de toute façon (« 2 places
-- restantes »). L'exception est plus étroite que ce qu'elle remplace.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ELLE S'EXÉCUTE DANS LA TRANSACTION DE L'APPELANT.
--
-- C'est vital, et ce n'est pas un détail d'implémentation : le
-- `SELECT … FOR UPDATE` sur `klass` ne protège la course que si le décompte
-- voit le MÊME instantané, sous le verrou tenu. Une fonction plpgsql
-- s'exécute dans la transaction appelante — donc même instantané, verrou tenu.
--
-- ⚠️ Contourner la RLS par une SECONDE CONNEXION (dblink, pool séparé) pour
-- faire ce compte relirait hors du verrou, sur un autre instantané, et
-- rouvrirait la course sans que rien ne casse visiblement. On échappe à la RLS
-- par `security definer` EN TRANSACTION, jamais par une connexion séparée.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LES STATUTS SONT UN ARGUMENT, PAS UNE CONSTANTE.
--
-- « Quels statuts occupent une place » est du vocabulaire métier, et il vit
-- dans `SEAT_TAKING_STATUSES` (`src/config/enrollment.ts`). Le recopier ici en
-- dur créerait une seconde définition — et le jour où `paused` cesserait
-- d'occuper une place, le SQL continuerait de le compter en silence. Il est
-- donc passé par l'appelant.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "count_seats_taken"(
  klass_id uuid,
  seat_statuses text[]
)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  current_org text := current_setting('app.current_org_id', true);
  owner_org text;
  taken integer;
BEGIN
  IF current_org IS NULL OR current_org = '' THEN
    RAISE EXCEPTION 'count_seats_taken appelee hors contexte d''ecole'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT k."organization_id" INTO owner_org
  FROM "klass" k
  WHERE k."id" = count_seats_taken.klass_id;

  IF owner_org IS NULL OR owner_org <> current_org THEN
    RAISE EXCEPTION 'cours introuvable dans cette ecole'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*)::integer INTO taken
  FROM "enrollment" e
  WHERE e."klass_id" = count_seats_taken.klass_id
    AND e."organization_id" = current_org
    AND e."status"::text = ANY (seat_statuses);

  RETURN taken;
END;
$$;
