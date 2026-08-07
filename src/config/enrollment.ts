/**
 * États d'une inscription.
 *
 * Une seule table porte le lien élève ↔ cours : être en liste d'attente est un
 * statut, pas une autre table. Deux représentations du même lien finiraient par
 * diverger — un élève inscrit d'un côté, en attente de l'autre.
 */
export const ENROLLMENT_STATUSES = [
  "active",
  "waitlisted",
  "paused",
  "ended",
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/**
 * Statuts « vivants » : ceux pour lesquels un élève ne peut avoir qu'une seule
 * inscription par cours.
 *
 * `ended` en est exclu à dessein. Un élève qui quitte un cours en octobre doit
 * pouvoir y revenir en janvier, et les deux passages doivent subsister — c'est
 * la même règle que pour le planning : on conserve les traces, on n'empêche pas
 * le retour.
 */
export const LIVE_ENROLLMENT_STATUSES = [
  "active",
  "waitlisted",
  "paused",
] as const satisfies readonly EnrollmentStatus[];

/**
 * Statuts qui occupent une place dans le bassin.
 *
 * `paused` en fait partie : une pause conserve la place. Sans cela, un élève
 * qui s'absente un mois la perdrait, et se retrouverait en fin de liste
 * d'attente à son retour — ce n'est pas ce qu'une école entend par « pause ».
 *
 * `waitlisted` n'occupe évidemment rien : c'est la définition de l'attente.
 */
export const SEAT_TAKING_STATUSES = [
  "active",
  "paused",
] as const satisfies readonly EnrollmentStatus[];

export function takesSeat(status: EnrollmentStatus): boolean {
  return (SEAT_TAKING_STATUSES as readonly string[]).includes(status);
}

/**
 * Statuts qui ne figurent PAS sur une feuille de présence.
 *
 * Une inscription en attente n'a jamais commencé : il n'y a rien à relever.
 * Extrait en configuration parce que `rosterWindowCondition` (TypeScript) et
 * `count_occurrence_attendees` (SQL) doivent s'accorder — le SQL reçoit cette
 * liste en argument plutôt que de la recopier, sinon les deux définitions du
 * roster divergeraient le jour où l'une change.
 */
export const ROSTER_EXCLUDED_STATUSES = ["waitlisted"] as const;
