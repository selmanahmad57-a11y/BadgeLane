import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

import { TENANT_CONTEXT_SETTING } from "../src/config/database";

/**
 * Éprouve le contrôle de capacité face à la concurrence réelle.
 *
 * ── Ce qui est testé ─────────────────────────────────────────────────────────
 *
 * Un cours d'une seule place. Deux inscriptions lancées **en même temps**,
 * depuis **deux connexions distinctes**. Une seule doit obtenir la place ;
 * l'autre doit basculer en liste d'attente.
 *
 * Le contrôle négatif refait la même chose **sans le verrou** : les deux
 * doivent alors passer, prouvant que la protection vient bien du verrou et non
 * d'un hasard d'ordonnancement.
 *
 * ── Pourquoi un vrai test et non un raisonnement ─────────────────────────────
 *
 * Une course est précisément ce qu'on ne voit pas en relisant du code : elle
 * dépend de l'entrelacement de deux transactions. Le seul moyen honnête de
 * savoir si le verrou fonctionne est de lancer la course.
 *
 * Contrairement aux autres sondes du projet, celle-ci **valide réellement** ses
 * transactions — sans cela, les deux connexions ne se verraient pas. Les
 * données créées sont donc supprimées en fin de test, dans un `finally`.
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
  klassId: string;
  studentIds: [string, string];
};

/**
 * Pose le contexte d'école **pour la transaction en cours**, jamais pour la
 * session.
 *
 * Cette sonde a longtemps utilisé la portée session. Elle fonctionnait — chaque
 * appel suit un `begin` de toute façon — mais elle reproduisait la forme
 * exacte de la faille que le produit évite : `DATABASE_URL` passe par un pooler
 * en mode transaction, où les connexions physiques sont recyclées **entre
 * tenants**. Un réglage de session y survit à la transaction, et la suivante en
 * hérite.
 *
 * Une sonde qui n'obéit pas à la règle qu'elle est censée éprouver finit par
 * mesurer autre chose que le produit. `db:verify` refuse désormais cette forme
 * partout — c'est lui qui a signalé cette ligne.
 */
async function setTenant(client: PoolClient, organizationId: string) {
  await client.query("select set_config($1, $2, true)", [
    TENANT_CONTEXT_SETTING,
    organizationId,
  ]);
}

/** Monte une école jetable : un cours d'une place et deux élèves. */
async function createFixture(
  client: PoolClient,
  defaults: { timezone: string; currency: string; country: string; locale: string },
): Promise<Fixture> {
  const organizationId = `probe_enroll_${crypto.randomUUID()}`;

  await client.query("begin");
  await setTenant(client, organizationId);

  await client.query(
    `insert into organization (id, name, timezone, currency, country, supported_languages)
     values ($1, $1, $2, $3, $4, $5)`,
    [
      organizationId,
      defaults.timezone,
      defaults.currency,
      defaults.country,
      [defaults.locale],
    ],
  );

  const program = await client.query(
    `insert into program (organization_id, name) values ($1, 'probe') returning id`,
    [organizationId],
  );
  const level = await client.query(
    `insert into level (organization_id, program_id, name, sort_order, color)
     values ($1, $2, 'probe', 10, '#000000') returning id`,
    [organizationId, program.rows[0].id],
  );
  const location = await client.query(
    `insert into location (organization_id, name) values ($1, 'probe') returning id`,
    [organizationId],
  );
  const term = await client.query(
    `insert into term (organization_id, name, start_date, end_date)
     values ($1, 'probe', '2026-09-01', '2026-12-15') returning id`,
    [organizationId],
  );

  /** Capacité 1 : la dernière place est aussi la première. */
  const klass = await client.query(
    `insert into klass
       (organization_id, term_id, program_id, level_id, location_id,
        title, day_of_week, start_time, duration_min, capacity)
     values ($1, $2, $3, $4, $5, 'probe', 2, '17:00', 30, 1) returning id`,
    [
      organizationId,
      term.rows[0].id,
      program.rows[0].id,
      level.rows[0].id,
      location.rows[0].id,
    ],
  );

  const family = await client.query(
    `insert into family (organization_id, primary_guardian_name, email, preferred_language)
     values ($1, 'probe', $2, $3) returning id`,
    [organizationId, `probe@${organizationId}.invalid`, defaults.locale],
  );

  const students = await client.query(
    `insert into student (organization_id, family_id, first_name, last_name, date_of_birth)
     values ($1, $2, 'Probe', 'One', '2015-01-01'),
            ($1, $2, 'Probe', 'Two', '2015-01-02')
     returning id`,
    [organizationId, family.rows[0].id],
  );

  await client.query("commit");

  return {
    organizationId,
    klassId: klass.rows[0].id,
    studentIds: [students.rows[0].id, students.rows[1].id],
  };
}

/**
 * Une tentative d'inscription, telle que l'application la fait.
 *
 * `useLock` permet de rejouer exactement la même séquence sans le verrou :
 * c'est le contrôle négatif.
 */
async function attemptEnrolment(
  client: PoolClient,
  fixture: Fixture,
  studentId: string,
  useLock: boolean,
): Promise<string> {
  await client.query("begin");
  await setTenant(client, fixture.organizationId);

  const klass = await client.query(
    `select capacity from klass where id = $1 ${useLock ? "for update" : ""}`,
    [fixture.klassId],
  );

  /** Fenêtre volontaire : sans verrou, l'autre transaction s'y engouffre. */
  await new Promise((resolve) => setTimeout(resolve, 150));

  const occupied = await client.query(
    `select count(*)::int as taken from enrollment
     where klass_id = $1 and status in ('active', 'paused')`,
    [fixture.klassId],
  );

  const hasSeat = occupied.rows[0].taken < klass.rows[0].capacity;
  const status = hasSeat ? "active" : "waitlisted";

  await client.query(
    `insert into enrollment (organization_id, klass_id, student_id, status, waitlisted_at, start_date)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      fixture.organizationId,
      fixture.klassId,
      studentId,
      status,
      hasSeat ? null : new Date(),
      hasSeat ? "2026-09-01" : null,
    ],
  );

  await client.query("commit");
  return status;
}

async function countActive(
  client: PoolClient,
  fixture: Fixture,
): Promise<number> {
  await client.query("begin");
  await setTenant(client, fixture.organizationId);
  const result = await client.query(
    `select count(*)::int as n from enrollment where klass_id = $1 and status = 'active'`,
    [fixture.klassId],
  );
  await client.query("rollback");
  return result.rows[0].n;
}

async function dropFixture(client: PoolClient, fixture: Fixture) {
  /**
   * Suppression avec le rôle propriétaire : le rôle applicatif ne peut pas
   * supprimer une organisation qu'il ne voit plus une fois hors contexte.
   */
  await client.query("begin");
  await setTenant(client, fixture.organizationId);
  await client.query("delete from organization where id = $1", [
    fixture.organizationId,
  ]);
  await client.query("commit");
}

async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const databaseUrl = process.env.DATABASE_URL;
  const defaults = {
    timezone: process.env.DEFAULT_ORGANIZATION_TIMEZONE ?? "",
    currency: process.env.DEFAULT_ORGANIZATION_CURRENCY ?? "",
    country: process.env.DEFAULT_ORGANIZATION_COUNTRY ?? "",
    locale: (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES ?? "").split(",")[0],
  };

  if (
    !databaseUrl ||
    !defaults.timezone ||
    !defaults.currency ||
    !defaults.country ||
    !defaults.locale
  ) {
    console.error(
      "Configuration incomplète dans .env.local (DATABASE_URL, DEFAULT_ORGANIZATION_*, NEXT_PUBLIC_SUPPORTED_LOCALES).",
    );
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString: databaseUrl });
  const setup = await pool.connect();
  const first = await pool.connect();
  const second = await pool.connect();

  let locked: Fixture | null = null;
  let unlocked: Fixture | null = null;

  try {
    console.log("\nCourse sur la dernière place — AVEC verrou");

    locked = await createFixture(setup, defaults);

    const lockedResults = await Promise.all([
      attemptEnrolment(first, locked, locked.studentIds[0], true),
      attemptEnrolment(second, locked, locked.studentIds[1], true),
    ]);

    const lockedActive = await countActive(setup, locked);

    check(
      "une seule inscription active dans un cours d'une place",
      lockedActive === 1,
      `${lockedActive} active(s)`,
    );
    check(
      "l'autre bascule en liste d'attente",
      lockedResults.filter((status) => status === "waitlisted").length === 1,
      lockedResults.join(" / "),
    );

    console.log("\nContrôle négatif — SANS verrou");

    unlocked = await createFixture(setup, defaults);

    await Promise.all([
      attemptEnrolment(first, unlocked, unlocked.studentIds[0], false),
      attemptEnrolment(second, unlocked, unlocked.studentIds[1], false),
    ]);

    const unlockedActive = await countActive(setup, unlocked);

    check(
      "sans verrou, la capacité est bien dépassée",
      unlockedActive === 2,
      `${unlockedActive} active(s) — si ce contrôle échoue, le test ne prouve rien`,
    );
  } finally {
    /** Les données de sonde sont validées en base : elles doivent partir. */
    if (locked) await dropFixture(setup, locked).catch(() => {});
    if (unlocked) await dropFixture(setup, unlocked).catch(() => {});

    setup.release();
    first.release();
    second.release();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nContrôle de capacité : OK.\n"
      : `\nContrôle de capacité : ÉCHEC — ${failures.length} contrôle(s).\n`,
  );

  return failures.length === 0 ? 0 : 1;
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
