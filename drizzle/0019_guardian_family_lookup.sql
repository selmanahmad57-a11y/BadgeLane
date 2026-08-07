-- Résolution d'un parent vers ses familles : l'amorçage du portail.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LE PROBLÈME — le même qu'en Semaine 1 et qu'au webhook Stripe.
--
-- Toute lecture de `guardian` est soumise à la RLS, laquelle exige un contexte
-- d'école. Or le portail parent doit justement DÉCOUVRIR de quelle école il
-- s'agit, à partir d'une adresse e-mail vérifiée par Clerk. On ne peut pas
-- poser un contexte qu'on cherche à établir.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE FONCTION, ET NON UNE VUE.
--
-- La tentation était de refaire `stripe_account_lookup` : une vue
-- `security_invoker = false` exposant (email, organization_id, family_id).
-- Elle aurait marché — et elle aurait été bien pire.
--
-- Cette vue serait une liste de TOUTES les adresses e-mail de TOUTES les
-- familles de TOUTES les écoles, interrogeable sans contexte. La vue Stripe est
-- défendable parce qu'elle ne porte que des identifiants opaques et aucune
-- donnée personnelle ; une vue d'adresses e-mail serait exactement l'inverse.
--
-- Une fonction inverse la charge de la preuve : il faut DÉJÀ connaître
-- l'adresse pour obtenir quoi que ce soit, et rien de ce qui sort n'est une
-- donnée personnelle — trois identifiants, rien d'autre. Aucune énumération
-- n'est possible.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE NE REND PAS, ET POURQUOI.
--
-- Ni le nom du tuteur, ni celui du foyer, ni la langue préférée. Tout cela est
-- lisible normalement, une fois le contexte posé par `withFamily()`. Faire
-- sortir d'ici la moindre donnée d'affichage reviendrait à élargir une
-- exception au lieu de la contenir.
--
-- `security definer` la fait s'exécuter avec les droits de son propriétaire,
-- donc hors RLS. `search_path` est verrouillé : sans cela, un schéma placé
-- devant `public` pourrait lui substituer une autre table `guardian`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "resolve_guardian_families"(emails text[])
  RETURNS TABLE (
    organization_id text,
    family_id uuid,
    guardian_id uuid
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT g."organization_id", g."family_id", g."id"
  FROM "guardian" g
  WHERE g."email" IS NOT NULL
    AND lower(g."email") = ANY (emails)
$$;
