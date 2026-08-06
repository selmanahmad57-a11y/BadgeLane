/**
 * États de présence relevés au bord du bassin.
 *
 * `makeup` figure au §3 du blueprint mais n'entre pas ici : les rattrapages
 * arrivent en Semaine 10. Même discipline que pour les champs de facturation
 * repoussés en Semaine 3 — on n'ajoute pas une valeur que rien ne produit.
 */
export const ATTENDANCE_STATUSES = ["present", "absent", "excused"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Clé de la file locale, cloisonnée par membre du personnel.
 *
 * Le cloisonnement n'est pas cosmétique : sur une tablette partagée, un coach
 * peut se connecter pendant que les taps d'un autre attendent encore. Sans
 * cloisonnement, ils seraient envoyés sous la mauvaise identité — et attribuer
 * un appel à quelqu'un qui ne l'a pas fait est une falsification, même
 * involontaire.
 *
 * L'alternative — faire porter l'identité par la file — la rendrait
 * falsifiable : le navigateur affirmerait qui a marqué. Ici le serveur
 * enregistre toujours sa propre session, et l'attribution est correcte par
 * construction.
 */
export function attendanceQueueKey(staffUserId: string): string {
  return `badgelane.attendance.queue.${staffUserId}`;
}

/** Délai entre deux tentatives de vidage, en millisecondes. */
export const QUEUE_RETRY_DELAY_MS = 5_000;
