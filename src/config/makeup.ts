/**
 * Rattrapages : le cycle de vie d'un crédit d'absence.
 *
 * ── DEUX états stockés, quatre états lus ─────────────────────────────────────
 *
 * Stockés : `available` et `booked`. Rien d'autre.
 *
 * « Expiré » et « consommé » sont **dérivés**, et ce n'est pas une coquetterie —
 * c'est ce qui rend correct le cas qui compte :
 *
 *   disponible  = available ET session non terminée
 *   réservé     = booked ET séance cible à venir ET non annulée
 *   consommé    = booked ET séance cible passée ET non annulée
 *   expiré      = available ET session terminée
 *
 * ── Le cas qui justifie tout : la séance cible annulée ───────────────────────
 *
 * Un crédit réservé sur une séance que l'école annule doit **redevenir
 * réservable**. En dérivant, c'est gratuit : la cible annulée sort des trois
 * autres branches, et le crédit se rouvre tout seul.
 *
 * Un `used` stocké obligerait à écrire un processus pour *défaire* la
 * consommation à chaque annulation — et ce processus oublierait un cas. Une
 * transition qu'on n'a pas écrite ne peut pas être oubliée.
 *
 * Aucune tâche de nuit non plus, et aucune fenêtre pendant laquelle un crédit
 * périmé paraîtrait valable parce que le cron n'est pas encore passé.
 *
 * Même règle que le DST, les badges et le rang de liste d'attente : on ne
 * matérialise pas ce qu'une requête peut dériver.
 */
export const MAKEUP_CREDIT_STATUSES = ["available", "booked"] as const;

export type MakeupCreditStatus = (typeof MAKEUP_CREDIT_STATUSES)[number];

/**
 * Statuts qui occupent une place dans une séance.
 *
 * Seul `booked` compte : un crédit disponible n'a encore réservé nulle part, et
 * un crédit consommé appartient à une séance passée.
 */
export const MAKEUP_OCCUPYING_STATUSES = ["booked"] as const;

/**
 * Jusqu'à quand un crédit reste utilisable.
 *
 * ── Une date dérivée, pas un nombre de jours ─────────────────────────────────
 *
 * L'échéance est la **fin de la session** à laquelle appartient la séance
 * manquée. Un rattrapage n'a de sens que tant que cette session vit : au terme
 * suivant, les niveaux, les inscriptions et le curriculum se réinitialisent.
 *
 * Un « 30 jours » entrerait en concurrence avec cette frontière — et créerait
 * un second nombre magique à garder cohérent avec le calendrier de l'école. La
 * date se dérive de `term.end_date`, donc prolonger une session prolonge ses
 * crédits, sans qu'aucune ligne ne soit réécrite.
 *
 * ── Le bord connu, et pourquoi on ne le mécanise pas ─────────────────────────
 *
 * Une absence en toute fin de session donne un crédit quasi expiré. Le report
 * automatique d'une session à l'autre serait une mécanique de plus, avec ses
 * propres cas limites. L'école prolonge à la main depuis sa file de revue —
 * `extended_until` — et garde la main, comme partout ailleurs.
 */
export const MAKEUP_EXPIRY_SOURCE = "term.end_date";

/**
 * États **lus** d'un crédit — dérivés, jamais stockés.
 *
 * L'ordre compte : un crédit dont la cible est annulée redevient disponible,
 * et cette branche doit être évaluée avant « consommé ».
 */
export const MAKEUP_DERIVED_STATES = [
  "available",
  "booked",
  "used",
  "expired",
] as const;

export type MakeupDerivedState = (typeof MAKEUP_DERIVED_STATES)[number];

/**
 * Un crédit ne naît que d'une séance où l'élève est **régulièrement inscrit**.
 *
 * Sans cette borne, un rattrapage engendrerait un rattrapage : la séance de
 * rattrapage est elle-même une occurrence future, le parent y signalerait une
 * absence, et l'on fabriquerait un second crédit — puis un troisième. La
 * génération est donc adossée au roster d'inscription (Semaine 6), jamais aux
 * réservations.
 */
export const MAKEUP_CREDIT_REQUIRES_ENROLMENT = true;
