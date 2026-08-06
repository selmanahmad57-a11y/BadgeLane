import type { OccurrenceStatus } from "@/config/scheduling";

/**
 * Génération et réconciliation des séances datées.
 *
 * ── Pourquoi ce module ne connaît ni base de données ni fuseau de serveur ────
 *
 * Une classe « mardi 17 h, America/New_York » n'est pas un instant : c'est une
 * règle de calendrier. Le produit stocke donc une **date civile** sur la séance
 * et une **heure civile** sur la classe, jamais un instant UTC.
 *
 * Le piège que cela évite : calculer l'instant de la première séance puis
 * ajouter sept fois vingt-quatre heures. Après le passage à l'heure d'hiver,
 * 21:00 UTC cesse d'être 17 h locales et devient 16 h — tout le planning
 * décale, deux fois par an.
 *
 * Ici, rien n'est converti, donc rien ne peut décaler.
 */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Dates civiles d'une classe hebdomadaire sur l'étendue d'une session.
 *
 * L'arithmétique se fait en UTC — non pas parce que les séances seraient en
 * UTC, mais parce que UTC est la seule ligne de temps **sans discontinuité** :
 * un jour y fait toujours exactement 24 heures. C'est un compteur de
 * calendrier, pas une horloge. Le même calcul avec les accesseurs locaux
 * dépendrait du fuseau de la machine qui exécute le code — ta machine, ou un
 * serveur Vercel — et donnerait des résultats différents.
 *
 * `dayOfWeek` suit la convention 0 = dimanche (voir `config/scheduling.ts`).
 */
export function occurrenceDatesFor(
  startDate: string,
  endDate: string,
  dayOfWeek: number,
): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  /** Nombre de jours entre le début de session et le premier jour visé. */
  const offsetDays = (dayOfWeek - new Date(start).getUTCDay() + 7) % 7;

  const dates: string[] = [];

  for (
    let instant = start + offsetDays * MILLISECONDS_PER_DAY;
    instant <= end;
    instant += 7 * MILLISECONDS_PER_DAY
  ) {
    dates.push(new Date(instant).toISOString().slice(0, 10));
  }

  return dates;
}

/**
 * Date civile « aujourd'hui » dans un fuseau donné.
 *
 * Nécessaire parce qu'« aujourd'hui » n'existe pas dans l'absolu : au même
 * instant, Auckland peut être au 7 quand Los Angeles est encore au 6. Sans
 * cette fonction, qu'une séance soit passée ou future dépendrait du fuseau du
 * serveur, pas de celui de l'école.
 *
 * Les composants sont assemblés à la main plutôt que de se fier au format
 * d'une locale : l'ordre jour/mois varie d'une langue à l'autre, et rien ne
 * garantit qu'une locale continue de formater comme aujourd'hui.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${find("year")}-${find("month")}-${find("day")}`;
}

export type ExistingOccurrence = {
  date: string;
  status: OccurrenceStatus;
  /**
   * La séance porte-t-elle une trace ? Présences saisies, plus tard résultats
   * de progression.
   *
   * Toujours `false` aujourd'hui — la table de présence n'existe pas encore.
   * Le paramètre est néanmoins présent dès maintenant, à dessein : la garde
   * doit exister **avant** la donnée qu'elle protège, sinon on l'ajoute après
   * la première perte.
   */
  hasDependencies: boolean;
};

export type ReconciliationPlan = {
  /** Dates attendues encore absentes. */
  toCreate: string[];
  /** Séances hors session, futures et vierges : de simples réservations. */
  toDelete: string[];
  /** Séances hors session mais protégées — conservées, et signalées. */
  protectedOutOfRange: ProtectedOccurrence[];
};

export type ProtectedOccurrence = {
  date: string;
  reason: "past" | "cancelled" | "has-dependencies";
};

/**
 * Réconcilie les séances existantes avec celles qu'exige la session.
 *
 * Trois règles, dans cet ordre :
 *
 *  - **Le passé est immuable.** Une séance déjà tenue est un fait, pas une
 *    prévision. Raccourcir une session ne réécrit pas l'histoire.
 *  - **Une annulation est une décision.** Quelqu'un a annulé cette séance
 *    délibérément ; la régénération n'a pas à effacer ce choix.
 *  - **Ce qui porte une trace est protégé.** Conservé et signalé, jamais
 *    supprimé en silence.
 *
 * Tout le reste — futur, vierge, hors session — n'était qu'une réservation
 * produite automatiquement : la retirer ne perd rien.
 *
 * Les dates sont comparées comme des chaînes, ce qui est exact au format
 * `AAAA-MM-JJ` : l'ordre lexicographique y coïncide avec l'ordre chronologique.
 */
export function planOccurrenceReconciliation({
  targetDates,
  existing,
  today,
}: {
  targetDates: readonly string[];
  existing: readonly ExistingOccurrence[];
  today: string;
}): ReconciliationPlan {
  const target = new Set(targetDates);
  const known = new Set(existing.map((entry) => entry.date));

  const toCreate = targetDates.filter((date) => !known.has(date));

  const toDelete: string[] = [];
  const protectedOutOfRange: ProtectedOccurrence[] = [];

  for (const entry of existing) {
    /** Dans la session : on n'y touche jamais, ni doublon ni écrasement. */
    if (target.has(entry.date)) continue;

    if (entry.date < today) {
      protectedOutOfRange.push({ date: entry.date, reason: "past" });
      continue;
    }

    if (entry.status === "cancelled") {
      protectedOutOfRange.push({ date: entry.date, reason: "cancelled" });
      continue;
    }

    if (entry.hasDependencies) {
      protectedOutOfRange.push({
        date: entry.date,
        reason: "has-dependencies",
      });
      continue;
    }

    toDelete.push(entry.date);
  }

  return { toCreate, toDelete, protectedOutOfRange };
}
