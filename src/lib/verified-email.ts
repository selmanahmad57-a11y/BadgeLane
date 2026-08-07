/**
 * Sélection des adresses e-mail **prouvées** d'un compte.
 *
 * ── Pourquoi ce module est minuscule et isolé ────────────────────────────────
 *
 * C'est la seule ligne de code qui décide à quelle famille un visiteur est
 * rattaché. Tout le portail parent en dépend : les politiques RLS filtrent
 * parfaitement les lignes d'une famille donnée, mais c'est ici que se décide
 * *laquelle*. Une barrière filtre, elle n'authentifie pas.
 *
 * Volontairement dépourvu de `server-only`, comme `action-result.ts` : la
 * garantie doit pouvoir être éprouvée par un script, hors de tout runtime
 * Next.js. Une règle de sécurité qu'on ne peut pas exécuter en CI est une
 * intention, pas une garantie.
 *
 * ── Ce que le filtre empêche ─────────────────────────────────────────────────
 *
 * Un compte peut *déclarer* n'importe quelle adresse. Seule la vérification
 * atteste qu'il en contrôle la boîte. Se fier à la liste brute laisserait
 * quiconque saisir l'adresse d'un parent et obtenir le portail de ses enfants —
 * leurs noms, leurs niveaux, leur école, leurs horaires.
 */

/** Statut d'adresse que Clerk considère comme prouvé. */
export const VERIFIED_EMAIL_STATUS = "verified";

/** Forme minimale attendue d'un compte, côté Clerk comme côté test. */
export type AccountEmailAddresses = {
  emailAddresses: {
    emailAddress: string;
    verification: { status: string | null } | null;
  }[];
};

/**
 * Les adresses vérifiées, normalisées en minuscules.
 *
 * Renvoie un tableau vide plutôt que de lever : un compte tout juste créé, dont
 * l'adresse n'est pas encore confirmée, n'est pas une anomalie — c'est un
 * visiteur qui n'a simplement encore droit à rien.
 *
 * La normalisation de casse est nécessaire, pas cosmétique : l'école saisit
 * l'adresse à la main sur la fiche du tuteur, le parent la tape à la connexion,
 * et « Parent@… » comme « parent@… » désignent la même boîte.
 */
export function verifiedEmailsOf(account: AccountEmailAddresses): string[] {
  return account.emailAddresses
    .filter((address) => address.verification?.status === VERIFIED_EMAIL_STATUS)
    .map((address) => address.emailAddress.trim().toLowerCase())
    .filter((address) => address.length > 0);
}
