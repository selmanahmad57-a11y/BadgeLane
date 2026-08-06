import { and, eq, gte, inArray, isNull, lte, ne, or, type SQL } from "drizzle-orm";

import { enrollment } from "./schema";

/**
 * Qui figure sur la feuille de présence d'une séance donnée.
 *
 * ── Pourquoi une fenêtre de dates et non le statut courant ───────────────────
 *
 * La feuille d'une séance est la liste des élèves inscrits **à cette date-là**,
 * pas de ceux inscrits aujourd'hui. La différence apparaît dès qu'on rattrape
 * un appel oublié : un enfant parti depuis doit figurer sur la feuille de la
 * semaine dernière — il était présent —, et un enfant arrivé lundi ne doit pas
 * apparaître sur celle d'avant son arrivée.
 *
 * Filtrer sur le statut courant réécrirait donc l'histoire à chaque départ.
 * C'est la même règle que pour les séances : le passé est immuable.
 *
 * Extrait ici, hors de `queries.ts` marqué `server-only`, pour que
 * `npm run attendance:verify` puisse éprouver la vraie condition plutôt qu'une
 * réécriture approximative.
 */
export function rosterWindowCondition(
  organizationId: string,
  klassIds: readonly string[],
  date: string,
): SQL | undefined {
  return and(
    eq(enrollment.organizationId, organizationId),
    inArray(enrollment.klassId, [...klassIds]),
    /** Une inscription en attente n'a jamais commencé : rien à relever. */
    ne(enrollment.status, "waitlisted"),
    /** Déjà entré ce jour-là. */
    lte(enrollment.startDate, date),
    /** Pas encore parti ce jour-là. */
    or(isNull(enrollment.endDate), gte(enrollment.endDate, date)),
  );
}
