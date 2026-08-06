import type { Locale } from "./i18n";

/**
 * Conventions du planning.
 *
 * Tout ce qui touche aux jours et aux heures est regroupé ici : ce sont
 * exactement les valeurs qui, éparpillées, produisent des décalages d'un jour
 * ou d'une heure que personne ne retrouve.
 */

/**
 * Jours de la semaine, indexés de 0 à 6 avec **dimanche = 0**.
 *
 * Convention JavaScript, choisie parce qu'elle correspond exactement à
 * `Date.prototype.getUTCDay()`. Toute autre numérotation imposerait une
 * conversion, et chaque conversion est une occasion de se décaler d'un jour.
 */
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export function isDayOfWeek(value: number): value is DayOfWeek {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * Ordre d'affichage des jours dans la grille, selon la langue.
 *
 * Les semaines ne commencent pas partout le même jour : dimanche aux
 * États-Unis, lundi en Espagne et en France. `Intl.Locale.getWeekInfo()` livre
 * l'information depuis les données CLDR — comme pour le sens d'écriture, on ne
 * tient aucune liste à la main.
 *
 * CLDR numérote les jours de 1 (lundi) à 7 (dimanche) ; nous, de 0 (dimanche) à
 * 6 (samedi). D'où la conversion, faite une seule fois, ici.
 */
type LocaleWithWeekInfo = Intl.Locale & {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
};

export function orderedDaysOfWeek(locale: Locale): DayOfWeek[] {
  let firstDayCldr = 1;

  try {
    const resolved = new Intl.Locale(locale) as LocaleWithWeekInfo;
    firstDayCldr =
      resolved.getWeekInfo?.().firstDay ?? resolved.weekInfo?.firstDay ?? 1;
  } catch {
    /** Langue non reconnue : on garde le lundi, usage majoritaire. */
  }

  /** CLDR 1..7 (lundi..dimanche) -> notre 0..6 (dimanche..samedi). */
  const firstDay = (firstDayCldr % 7) as DayOfWeek;

  return DAYS_OF_WEEK.map(
    (offset) => ((firstDay + offset) % 7) as DayOfWeek,
  );
}

/** Statuts d'une séance datée. */
export const OCCURRENCE_STATUSES = ["scheduled", "cancelled"] as const;

export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

/**
 * Bornes de saisie d'un cours.
 *
 * Elles ne cherchent pas à décrire ce qui est pédagogiquement raisonnable, mais
 * à rattraper une faute de frappe : une durée de 5 000 minutes ou une capacité
 * de 900 places est une erreur de saisie, pas une intention.
 */
export const CLASS_DURATION_MINUTES = { minimum: 5, maximum: 480 } as const;
export const CLASS_CAPACITY = { minimum: 1, maximum: 200 } as const;

/** Format `HH:MM` accepté par `input[type=time]` et par le type `time` Postgres. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Format de date civile `AAAA-MM-JJ`. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Nombre maximal d'occurrences qu'une seule génération peut créer.
 *
 * Un garde-fou, pas une limite produit : une session de dix ans saisie par
 * erreur ne doit pas insérer des milliers de lignes avant qu'on s'en aperçoive.
 */
export const MAX_GENERATED_OCCURRENCES = 400;
