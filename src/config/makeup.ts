/**
 * Rattrapages : le cycle de vie d'un crédit d'absence.
 *
 * ── Trois états, et pas quatre ───────────────────────────────────────────────
 *
 * `available → booked → used`. « Expiré » n'en fait **pas** partie, et c'est la
 * décision structurante de ce module.
 *
 * Un crédit est utilisable si — et seulement si — il est `available` **et** que
 * la session dont il est issu n'est pas terminée. C'est un prédicat de lecture,
 * pas une transition : aucune tâche planifiée n'a besoin de passer les crédits
 * en « expiré » la nuit venue, et il n'existe aucune fenêtre pendant laquelle
 * un crédit périmé paraîtrait encore valable parce que le cron n'est pas passé.
 *
 * Même règle que le DST, les badges et le rang de liste d'attente : on ne
 * matérialise pas ce qu'une requête peut dériver.
 */
export const MAKEUP_CREDIT_STATUSES = ["available", "booked", "used"] as const;

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
