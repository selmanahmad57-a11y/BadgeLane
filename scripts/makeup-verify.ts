import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

import { FAMILY_CONTEXT_SETTING } from "../src/config/access";
import { TENANT_CONTEXT_SETTING } from "../src/config/database";
import {
  ROSTER_EXCLUDED_STATUSES,
  SEAT_TAKING_STATUSES,
} from "../src/config/enrollment";
import { MAKEUP_OCCUPYING_STATUSES } from "../src/config/makeup";
import { makeupCreditState } from "../src/lib/makeup";
import { UNIQUE_VIOLATION_SQLSTATE as UNIQUE_VIOLATION } from "../src/config/database";

/**
 * Éprouve la capacité d'une SÉANCE face à deux rattrapages simultanés.
 *
 * ── Pourquoi ce script existe, alors qu'`enrollment:verify` existe déjà ──────
 *
 * Le verrou de la Semaine 5 protège la capacité d'un COURS : une classe de huit
 * n'accepte pas neuf inscrits. Un rattrapage ne touche pas à ce compte — il
 * ajoute un corps de plus à **une seule séance**. Les deux mécanismes se
 * ressemblent et ne protègent pas la même chose.
 *
 * ── Le contrôle négatif qui compte ───────────────────────────────────────────
 *
 * Il ne retire pas le verrou : il garde tout à l'identique et remplace le
 * compteur de séance par celui de classe. Une classe à deux places dont une
 * seule est occupée paraît avoir de la place — donc les deux rattrapages
 * passent, et la séance se retrouve à trois dans un bassin de deux.
 *
 * Une seule variable bouge : le niveau auquel on compte. L'effet mesuré est
 * donc exactement celui de `count_occurrence_attendees`.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  console.log(
    condition ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(label);
}

type Fixture = {
  organizationId: string;
  occurrenceId: string;
  capacity: number;
  familyIds: [string, string];
  creditIds: [string, string];
};

/** Contexte toujours LOCAL à la transaction — la règle du dépôt depuis la S10. */
async function open(client: PoolClient, org: string, family: string) {
  await client.query("begin");
  await client.query("select set_config($1, $2, true)", [TENANT_CONTEXT_SETTING, org]);
  await client.query("select set_config($1, $2, true)", [FAMILY_CONTEXT_SETTING, family]);
}

async function createFixture(
  client: PoolClient,
  defaults: { timezone: string; currency: string; country: string; locale: string },
): Promise<Fixture> {
  const organizationId = `probe_makeup_${crypto.randomUUID()}`;
  const capacity = 2;

  await open(client, organizationId, "");
  await client.query(
    `insert into organization (id, name, timezone, currency, country, supported_languages)
     values ($1, $1, $2, $3, $4, array[$5]::text[])`,
    [organizationId, defaults.timezone, defaults.currency, defaults.country, defaults.locale],
  );

  const program = (await client.query(
    `insert into program (organization_id, name) values ($1, 'P') returning id`, [organizationId])).rows[0].id;
  const level = (await client.query(
    `insert into level (organization_id, program_id, name, color, sort_order)
     values ($1, $2, 'L', '#000', 1) returning id`, [organizationId, program])).rows[0].id;
  const place = (await client.query(
    `insert into location (organization_id, name) values ($1, 'Bassin') returning id`, [organizationId])).rows[0].id;
  const term = (await client.query(
    `insert into term (organization_id, name, start_date, end_date)
     values ($1, 'T', '2026-09-01', '2026-12-01') returning id`, [organizationId])).rows[0].id;
  const klass = (await client.query(
    `insert into klass (organization_id, term_id, program_id, level_id, location_id,
                        title, day_of_week, start_time, duration_min, capacity)
     values ($1, $2, $3, $4, $5, 'Cours', 2, '17:00', 30, $6) returning id`,
    [organizationId, term, program, level, place, capacity])).rows[0].id;

  const missed = (await client.query(
    `insert into class_occurrence (organization_id, klass_id, date, status)
     values ($1, $2, '2026-09-08', 'scheduled') returning id`, [organizationId, klass])).rows[0].id;
  const target = (await client.query(
    `insert into class_occurrence (organization_id, klass_id, date, status)
     values ($1, $2, '2026-09-15', 'scheduled') returning id`, [organizationId, klass])).rows[0].id;

  const families: string[] = [];
  const credits: string[] = [];

  for (const [index, name] of ["Régulier", "Foyer A", "Foyer B"].entries()) {
    const family = (await client.query(
      `insert into family (organization_id, primary_guardian_name, email, preferred_language)
       values ($1, $2, $3, $4) returning id`,
      [organizationId, name, `${index}@${organizationId}.invalid`, defaults.locale])).rows[0].id;

    const studentId = (await client.query(
      `insert into student (organization_id, family_id, first_name, last_name, date_of_birth, current_level_id)
       values ($1, $2, $3, 'X', '2018-01-01', $4) returning id`,
      [organizationId, family, name, level])).rows[0].id;

    if (index === 0) {
      /** L'élève régulier occupe UNE des deux places de la séance cible. */
      await client.query(
        `insert into enrollment (organization_id, klass_id, student_id, status, start_date)
         values ($1, $2, $3, 'active', '2026-09-01')`, [organizationId, klass, studentId]);
      continue;
    }

    families.push(family);
    credits.push((await client.query(
      `insert into makeup_credit (organization_id, student_id, missed_occurrence_id, status)
       values ($1, $2, $3, 'available') returning id`,
      [organizationId, studentId, missed])).rows[0].id);
  }

  await client.query("commit");

  return {
    organizationId,
    occurrenceId: target,
    capacity,
    familyIds: [families[0], families[1]],
    creditIds: [credits[0], credits[1]],
  };
}

/**
 * Une réservation de rattrapage, telle que le portail la fera.
 *
 * `atOccurrenceLevel` est la seule variable du contrôle négatif : le verrou, la
 * fenêtre et l'écriture sont identiques dans les deux cas.
 */
async function bookMakeup(
  client: PoolClient,
  fixture: Fixture,
  index: 0 | 1,
  atOccurrenceLevel: boolean,
): Promise<{ booked: boolean; seen: number }> {
  await open(client, fixture.organizationId, fixture.familyIds[index]);

  /** Le verrou porte sur la SÉANCE, pas sur le cours. */
  const occurrence = await client.query(
    `select o.id, o.klass_id, k.capacity
       from class_occurrence o join klass k on k.id = o.klass_id
      where o.id = $1 for update of o`,
    [fixture.occurrenceId],
  );

  const seen = Number(
    atOccurrenceLevel
      ? (await client.query("select count_occurrence_attendees($1,$2,$3) n", [
          fixture.occurrenceId,
          [...ROSTER_EXCLUDED_STATUSES],
          [...MAKEUP_OCCUPYING_STATUSES],
        ])).rows[0].n
      : (await client.query("select count_seats_taken($1,$2) n", [
          occurrence.rows[0].klass_id,
          [...SEAT_TAKING_STATUSES],
        ])).rows[0].n,
  );

  await new Promise((resolve) => setTimeout(resolve, 150));

  const hasRoom = seen < Number(occurrence.rows[0].capacity);

  if (hasRoom) {
    await client.query(
      `update makeup_credit set booked_occurrence_id = $1, status = 'booked'
        where id = $2`,
      [fixture.occurrenceId, fixture.creditIds[index]],
    );
  }

  await client.query("commit");
  return { booked: hasRoom, seen };
}

async function attendees(client: PoolClient, fixture: Fixture): Promise<number> {
  await open(client, fixture.organizationId, "");
  const { rows } = await client.query("select count_occurrence_attendees($1,$2,$3) n", [
    fixture.occurrenceId,
    [...ROSTER_EXCLUDED_STATUSES],
    [...MAKEUP_OCCUPYING_STATUSES],
  ]);
  await client.query("commit");
  return Number(rows[0].n);
}

async function drop(client: PoolClient, fixture: Fixture) {
  await open(client, fixture.organizationId, "");
  await client.query("delete from organization where id = $1", [fixture.organizationId]);
  await client.query("commit");
}

async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const connectionString = process.env.DATABASE_URL;
  const defaults = {
    timezone: process.env.DEFAULT_ORGANIZATION_TIMEZONE ?? "",
    currency: process.env.DEFAULT_ORGANIZATION_CURRENCY ?? "",
    country: process.env.DEFAULT_ORGANIZATION_COUNTRY ?? "",
    locale: (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES ?? "").split(",")[0],
  };

  if (!connectionString || !defaults.timezone || !defaults.currency || !defaults.country || !defaults.locale) {
    console.error("\nConfiguration incomplète dans .env.local.\n");
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString });
  const setup = await pool.connect();
  const first = await pool.connect();
  const second = await pool.connect();

  let correct: Fixture | null = null;
  let naive: Fixture | null = null;

  try {
    // ── La machine à états, dérivée ───────────────────────────────────────
    //
    // Deux valeurs stockées, quatre états lus. Cette partie est de la logique
    // pure : aucune base, donc entièrement vérifiable — et c'est voulu, parce
    // que c'est elle qui décide si un crédit est utilisable.

    console.log("\nÉtats dérivés d'un crédit");

    const today = "2026-10-01";
    const base = { usableThrough: "2026-12-01", bookedOn: null, bookedOccurrenceStatus: null, today };

    check(
      "disponible : available, session en cours",
      makeupCreditState({ ...base, status: "available" }) === "available",
    );
    check(
      "expiré : available, session terminée",
      makeupCreditState({ ...base, status: "available", usableThrough: "2026-09-01" }) === "expired",
    );
    check(
      "réservé : booked, séance à venir",
      makeupCreditState({ ...base, status: "booked", bookedOn: "2026-11-01", bookedOccurrenceStatus: "scheduled" }) === "booked",
    );
    check(
      "consommé : booked, séance passée",
      makeupCreditState({ ...base, status: "booked", bookedOn: "2026-09-15", bookedOccurrenceStatus: "scheduled" }) === "used",
    );

    /**
     * LE cas qui justifie la dérivation. Un `used` stocké obligerait à écrire
     * un processus pour défaire la consommation — et il oublierait ce cas.
     */
    check(
      "séance cible ANNULÉE : le crédit redevient disponible",
      makeupCreditState({ ...base, status: "booked", bookedOn: "2026-09-15", bookedOccurrenceStatus: "cancelled" }) === "available",
      makeupCreditState({ ...base, status: "booked", bookedOn: "2026-09-15", bookedOccurrenceStatus: "cancelled" }),
    );
    check(
      "annulée après la fin de session : expiré, pas disponible",
      makeupCreditState({ ...base, status: "booked", usableThrough: "2026-09-01", bookedOn: "2026-08-20", bookedOccurrenceStatus: "cancelled" }) === "expired",
    );

    /** L'échéance se compare en dates CIVILES, jamais en instants. */
    check(
      "le dernier jour de session, le crédit vaut encore",
      makeupCreditState({ ...base, status: "available", usableThrough: today }) === "available",
    );

    console.log("\nDeux rattrapages sur la dernière place d'une SÉANCE");

    correct = await createFixture(setup, defaults);
    const before = await attendees(setup, correct);
    check(
      "la séance part avec un élève régulier sur deux places",
      before === 1 && correct.capacity === 2,
      `${before}/${correct.capacity}`,
    );

    const results = await Promise.all([
      bookMakeup(first, correct, 0, true),
      bookMakeup(second, correct, 1, true),
    ]);

    const after = await attendees(setup, correct);

    check(
      "un seul rattrapage est réservé",
      results.filter((entry) => entry.booked).length === 1,
      results.map((entry) => (entry.booked ? "réservé" : "refusé")).join(" / "),
    );
    check(
      "la séance atteint sa capacité, sans la dépasser",
      after === correct.capacity,
      `${after}/${correct.capacity}`,
    );
    check(
      "l'un des deux a vu la séance déjà pleine",
      results.some((entry) => entry.seen === correct!.capacity),
      results.map((entry) => `vu ${entry.seen}`).join(" / "),
    );

    // ── Les invariants sont des contraintes, pas des contrôles ────────────

    console.log("\nLes invariants tiennent par la base, pas par du code");

    await open(setup, correct.organizationId, "");

    /** Le double-tap : la même absence, deux fois. */
    const missed = (await setup.query(
      "select missed_occurrence_id, student_id from makeup_credit where id = $1",
      [correct.creditIds[0]],
    )).rows[0];

    await setup.query("savepoint duplicate_absence");
    const twice = await setup
      .query(
        `insert into makeup_credit (organization_id, student_id, missed_occurrence_id)
         values ($1, $2, $3)`,
        [correct.organizationId, missed.student_id, missed.missed_occurrence_id],
      )
      .then(() => "acceptée")
      .catch((error: { code?: string }) => error.code ?? "refusée");
    await setup.query("rollback to savepoint duplicate_absence");

    check(
      "signaler deux fois la même absence ne crée qu'un crédit",
      twice === UNIQUE_VIOLATION,
      `${twice} — attendu ${UNIQUE_VIOLATION}`,
    );

    /** Deux crédits distincts ne peuvent pas viser la même séance. */
    const booked = (await setup.query(
      "select id, student_id from makeup_credit where booked_occurrence_id = $1",
      [correct.occurrenceId],
    )).rows[0];

    /** Une TROISIÈME séance : la sonde ne doit pas buter sur sa propre unicité. */
    const anotherMissed = (await setup.query(
      `insert into class_occurrence (organization_id, klass_id, date, status)
       values ($1, (select klass_id from class_occurrence where id = $2), '2026-09-22', 'scheduled')
       returning id`,
      [correct.organizationId, correct.occurrenceId],
    )).rows[0].id;

    const spareCredit = (await setup.query(
      `insert into makeup_credit (organization_id, student_id, missed_occurrence_id)
       values ($1, $2, $3) returning id`,
      [correct.organizationId, booked.student_id, anotherMissed],
    )).rows[0].id;

    await setup.query("savepoint double_seat");
    const twoSeats = await setup
      .query(
        `update makeup_credit set booked_occurrence_id = $1, status = 'booked' where id = $2`,
        [correct.occurrenceId, spareCredit],
      )
      .then(() => "acceptée")
      .catch((error: { code?: string }) => error.code ?? "refusée");
    await setup.query("rollback to savepoint double_seat");

    check(
      "un enfant n'occupe pas deux places dans la même séance",
      twoSeats === UNIQUE_VIOLATION,
      `${twoSeats} — attendu ${UNIQUE_VIOLATION}`,
    );

    await setup.query("commit");

    // ── La séance cible annulée, en base cette fois ───────────────────────

    console.log("\nLa séance cible annulée rouvre le crédit — en base");

    await open(setup, correct.organizationId, "");
    await setup.query(
      "update class_occurrence set status = 'cancelled' where id = $1",
      [correct.occurrenceId],
    );

    const reopened = (await setup.query(
      `select m.status, o.status as target_status, o.date as booked_on
         from makeup_credit m
         join class_occurrence o on o.id = m.booked_occurrence_id
        where m.booked_occurrence_id = $1`,
      [correct.occurrenceId],
    )).rows[0];
    await setup.query("commit");

    check(
      "le statut STOCKÉ n'a pas bougé — aucune transition n'a été écrite",
      reopened.status === "booked",
      String(reopened.status),
    );
    check(
      "et l'état LU est redevenu disponible",
      makeupCreditState({
        status: "booked",
        usableThrough: "2026-12-01",
        bookedOn: String(reopened.booked_on).slice(0, 10),
        bookedOccurrenceStatus: reopened.target_status,
        today: "2026-10-01",
      }) === "available",
    );

    console.log(
      "\nContrôle négatif — même verrou, mais décompte au niveau du COURS",
    );

    naive = await createFixture(setup, defaults);

    const naiveResults = await Promise.all([
      bookMakeup(first, naive, 0, false),
      bookMakeup(second, naive, 1, false),
    ]);

    const naiveAfter = await attendees(setup, naive);

    check(
      "au niveau du cours, la classe paraît avoir de la place",
      naiveResults.every((entry) => entry.seen < naive!.capacity),
      naiveResults.map((entry) => `vu ${entry.seen}`).join(" / "),
    );
    check(
      "et la séance dépasse sa capacité",
      naiveAfter > naive.capacity,
      `${naiveAfter}/${naive.capacity} — si ce contrôle échoue, le précédent ne prouve rien`,
    );
  } catch (error) {
    console.error("\n  erreur :", (error as Error).message);
    failures.push("exécution");
  } finally {
    if (correct) await drop(setup, correct).catch(() => {});
    if (naive) await drop(setup, naive).catch(() => {});
    setup.release();
    first.release();
    second.release();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nRattrapages : OK.\n"
      : `\nRattrapages : ÉCHEC — ${failures.length} contrôle(s).\n`,
  );

  return failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
