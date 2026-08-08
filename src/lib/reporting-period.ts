/**
 * La période d'un rapport mensuel — « 2026-08 ».
 *
 * ── Une décision, pas une déduction de l'horloge ────────────────────────────
 *
 * La période est un **paramètre**, avec le dernier mois révolu pour défaut.
 * Elle n'est jamais dérivée de « maintenant » au moment de l'envoi, et ce
 * choix a deux raisons :
 *
 *  1. **Le rejeu devient possible.** Renvoyer août en octobre n'a de sens que
 *     si la période se nomme. Couplée à l'horloge, elle serait toujours « le
 *     mois d'avant maintenant » — donc irrattrapable.
 *  2. **Le bord disparaît.** `now() - interval '1 month'` lancé le 31 août
 *     rend le 31 juillet… soit juillet, pas août. Les mois n'ont pas la même
 *     longueur, et une soustraction d'intervalle le fait payer aux bords.
 *
 * On travaille donc sur le couple année/mois, jamais sur une durée.
 *
 * ── Le calendrier est celui de l'ÉCOLE ──────────────────────────────────────
 *
 * Le jour de référence vient de `todayInTimeZone(school.timezone)`. À 23 h le
 * 31 août à Los Angeles, on est encore en août ; au même instant à New York on
 * est le 1er septembre. Deux écoles, deux mois civils — et c'est la réalité
 * vécue par chacune.
 */

/** `YYYY-MM`, la forme d'une période. */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(value: string): boolean {
  return PERIOD_PATTERN.test(value);
}

/**
 * Le dernier mois **révolu**, à partir d'une date civile `YYYY-MM-DD`.
 *
 * Jamais le mois courant : un rapport mensuel envoyé le 12 ne peut pas
 * prétendre couvrir un mois qui n'est pas fini.
 */
export function previousCivilMonth(today: string): string {
  const [year, month] = today.split("-").map(Number);

  const previous = month === 1 ? 12 : month - 1;
  const inYear = month === 1 ? year - 1 : year;

  return `${inYear}-${String(previous).padStart(2, "0")}`;
}

/** Le mois civil auquel appartient une date, dans le même format. */
export function civilMonthOf(date: string): string {
  return date.slice(0, 7);
}
