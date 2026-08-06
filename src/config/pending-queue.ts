/**
 * Clés de stockage des files de « taps durables ».
 *
 * Deux dimensions, toutes deux nécessaires :
 *
 *  - le **membre**, parce qu'une tablette est partagée et que les gestes d'un
 *    coach ne doivent jamais partir sous la session d'un autre ;
 *  - le **type d'écriture**, pour qu'une file bloquée n'en retienne pas une
 *    autre — un problème sur la présence ne doit pas figer la progression.
 */
export type PendingQueueKind = "attendance" | "progress";

export function pendingQueueKey(
  kind: PendingQueueKind,
  staffUserId: string,
): string {
  return `badgelane.${kind}.queue.${staffUserId}`;
}

/** Délai entre deux tentatives de vidage, en millisecondes. */
export const QUEUE_RETRY_DELAY_MS = 5_000;
