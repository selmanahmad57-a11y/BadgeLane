import {
  occurrenceDatesFor,
  planOccurrenceReconciliation,
  todayInTimeZone,
} from "../src/lib/occurrences";

/**
 * Éprouve la génération des séances et la réconciliation.
 *
 * Ces fonctions n'ont besoin ni de base de données ni de session : elles sont
 * donc les seules du projet à pouvoir être testées entièrement, sans navigateur.
 * Vu ce qu'elles décident — les dates de tout un planning, deux fois par an
 * autour des changements d'heure — elles le méritent.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

/** Jour de la semaine d'une date civile, en UTC : 0 = dimanche. */
const dayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

console.log("\nGénération — traversée d'un changement d'heure");

/**
 * Aux États-Unis, l'heure d'été prend fin le premier dimanche de novembre :
 * le 1er novembre 2026. Une session qui l'enjambe est le cas exact où une
 * génération fondée sur des instants UTC dériverait d'une heure.
 */
const autumn = occurrenceDatesFor("2026-10-06", "2026-12-15", 2);

check(
  "toutes les dates générées tombent un mardi",
  autumn.every((date) => dayOf(date) === 2),
  autumn.filter((date) => dayOf(date) !== 2).join(", "),
);
check(
  "la session couvre bien le changement d'heure du 1er novembre",
  autumn.some((date) => date < "2026-11-01") &&
    autumn.some((date) => date > "2026-11-01"),
);
check(
  "les dates s'enchaînent de sept jours exactement",
  autumn.every((date, index) => {
    if (index === 0) return true;
    const previous = Date.parse(`${autumn[index - 1]}T00:00:00Z`);
    return Date.parse(`${date}T00:00:00Z`) - previous === 7 * 86400000;
  }),
);

/** Passage à l'heure d'été : 8 mars 2026 aux États-Unis. */
const spring = occurrenceDatesFor("2026-02-10", "2026-04-14", 2);
check(
  "idem en traversant le passage à l'heure d'été",
  spring.every((date) => dayOf(date) === 2) &&
    spring.some((date) => date < "2026-03-08") &&
    spring.some((date) => date > "2026-03-08"),
);

/** Hémisphère sud : les transitions y sont inversées. */
const southern = occurrenceDatesFor("2026-03-02", "2026-05-04", 1);
check(
  "hémisphère sud : tous les lundis, transitions inversées comprises",
  southern.every((date) => dayOf(date) === 1) && southern.length === 10,
  `${southern.length} dates`,
);

console.log("\nGénération — cas limites");

check(
  "session d'un seul jour, tombant le bon jour de semaine",
  occurrenceDatesFor("2026-09-01", "2026-09-01", 2).length === 1,
);
check(
  "session d'un seul jour, tombant un autre jour",
  occurrenceDatesFor("2026-09-01", "2026-09-01", 3).length === 0,
);
check(
  "dates inversées : aucune séance plutôt qu'une erreur",
  occurrenceDatesFor("2026-12-01", "2026-09-01", 2).length === 0,
);
check(
  "date invalide : aucune séance plutôt qu'une erreur",
  occurrenceDatesFor("pas-une-date", "2026-09-01", 2).length === 0,
);
check(
  "une année entière de mardis donne 52 ou 53 séances",
  [52, 53].includes(occurrenceDatesFor("2026-01-01", "2026-12-31", 2).length),
  `${occurrenceDatesFor("2026-01-01", "2026-12-31", 2).length} dates`,
);
check(
  "le 29 février d'une année bissextile est correctement traversé",
  occurrenceDatesFor("2028-02-01", "2028-03-31", 2).every(
    (date) => dayOf(date) === 2,
  ),
);

console.log("\n« Aujourd'hui » dépend du fuseau de l'école");

/** Instant où Auckland est déjà au lendemain de Los Angeles. */
const instant = new Date("2026-08-06T17:36:00Z");
check(
  "Los Angeles et Auckland ne sont pas à la même date",
  todayInTimeZone("America/Los_Angeles", instant) !==
    todayInTimeZone("Pacific/Auckland", instant),
  `${todayInTimeZone("America/Los_Angeles", instant)} vs ${todayInTimeZone("Pacific/Auckland", instant)}`,
);
check(
  "le format reste AAAA-MM-JJ",
  /^\d{4}-\d{2}-\d{2}$/.test(todayInTimeZone("Europe/Paris", instant)),
);

console.log("\nRéconciliation — passé immuable, futur vide régénérable");

const plan = planOccurrenceReconciliation({
  targetDates: ["2026-09-01", "2026-09-08", "2026-09-15"],
  existing: [
    /** Déjà tenue, désormais hors session : l'histoire ne se réécrit pas. */
    { date: "2026-08-25", status: "scheduled", hasDependencies: false },
    /** Dans la session : intouchable. */
    { date: "2026-09-01", status: "scheduled", hasDependencies: false },
    /** Future, vierge, hors session : simple réservation. */
    { date: "2026-09-22", status: "scheduled", hasDependencies: false },
    /** Future, hors session, mais annulée : une décision se respecte. */
    { date: "2026-09-29", status: "cancelled", hasDependencies: false },
    /** Future, hors session, mais porteuse de données : protégée. */
    { date: "2026-10-06", status: "scheduled", hasDependencies: true },
  ],
  today: "2026-09-01",
});

check(
  "crée uniquement les dates manquantes",
  JSON.stringify(plan.toCreate) ===
    JSON.stringify(["2026-09-08", "2026-09-15"]),
  JSON.stringify(plan.toCreate),
);
check(
  "ne supprime que la séance future, vierge et hors session",
  JSON.stringify(plan.toDelete) === JSON.stringify(["2026-09-22"]),
  JSON.stringify(plan.toDelete),
);
check(
  "protège le passé, l'annulation et la séance porteuse de données",
  plan.protectedOutOfRange.length === 3 &&
    plan.protectedOutOfRange.some((entry) => entry.reason === "past") &&
    plan.protectedOutOfRange.some((entry) => entry.reason === "cancelled") &&
    plan.protectedOutOfRange.some(
      (entry) => entry.reason === "has-dependencies",
    ),
  JSON.stringify(plan.protectedOutOfRange),
);

console.log("\nRéconciliation — idempotence");

const settled = planOccurrenceReconciliation({
  targetDates: ["2026-09-01", "2026-09-08"],
  existing: [
    { date: "2026-09-01", status: "scheduled", hasDependencies: false },
    { date: "2026-09-08", status: "cancelled", hasDependencies: false },
  ],
  today: "2026-08-01",
});

check(
  "un second passage ne crée ni ne supprime rien",
  settled.toCreate.length === 0 &&
    settled.toDelete.length === 0 &&
    settled.protectedOutOfRange.length === 0,
  JSON.stringify(settled),
);
check(
  "une séance annulée dans la session n'est pas recréée",
  !settled.toCreate.includes("2026-09-08"),
);

console.log(
  failures.length === 0
    ? "\nPlanning : OK.\n"
    : `\nPlanning : ÉCHEC — ${failures.length} contrôle(s).\n`,
);

process.exitCode = failures.length === 0 ? 0 : 1;
