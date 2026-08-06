/**
 * États de progression sur une compétence.
 *
 * `not_started` **n'existe pas** : c'est l'absence de ligne. Le stocker
 * imposerait de créer une ligne par (élève, compétence) d'avance — pour vingt
 * élèves et quarante compétences, huit cents lignes qui ne disent rien — et
 * de repeupler à chaque ajout au curriculum. Même refus qu'ailleurs : une
 * donnée dérivable ne se stocke pas.
 *
 * `in_progress` est conservé : « travaille le dos » a une valeur pédagogique
 * réelle pour un parent. Il ne compte pas dans le badge — seul `achieved`
 * complète un niveau.
 */
export const PROGRESS_STATUSES = ["in_progress", "achieved"] as const;

export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
