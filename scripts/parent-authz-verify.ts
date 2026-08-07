import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

import { FAMILY_CONTEXT_SETTING } from "../src/config/access";
import { TENANT_CONTEXT_SETTING } from "../src/config/database";
import { verifiedEmailsOf } from "../src/lib/verified-email";

/**
 * Éprouve le second axe d'autorisation : la famille.
 *
 * ── Pourquoi ce script existe ────────────────────────────────────────────────
 *
 * La Semaine 10 ouvre une porte d'accès entièrement nouvelle. Jusqu'ici une
 * seule question décidait de tout — « de quelle école s'agit-il ? ». Il y en a
 * désormais deux, et la seconde découpe *à l'intérieur* d'une école, là où
 * toutes les données se ressemblent et où une politique trop large ne se voit
 * pas.
 *
 * ── Les deux pièges que ce script vise ───────────────────────────────────────
 *
 * 1. LA POLITIQUE À SOUS-REQUÊTE. `enrollment`, `attendance` et
 *    `skill_progress` ne portent pas de `family_id` : leur restriction passe par
 *    un `student_id in (select … from student …)`. C'est le point faible
 *    classique du RLS — une politique de cette forme peut être syntaxiquement
 *    irréprochable et ne filtrer strictement rien. On ne la relit pas, on
 *    l'éprouve.
 *
 * 2. LE TEST QUI PASSE SUR DU VIDE. Prouver « le parent ne voit pas l'autre
 *    famille » ne vaut rien si l'autre famille n'a aucune ligne. Chaque refus
 *    est donc doublé de son contraire : **les mêmes requêtes, contexte famille
 *    vide, doivent renvoyer des lignes**. C'est le contrôle du contrôle.
 *
 * ── Et la ligne qui porte tout ───────────────────────────────────────────────
 *
 * Le rattachement d'un compte à une famille se fait sur les adresses dont Clerk
 * atteste la vérification. Une adresse simplement déclarée ne doit rattacher
 * personne — sans quoi n'importe qui saisirait l'adresse d'un parent pour
 * obtenir le portail de ses enfants. C'est de la logique pure, donc vérifiable
 * sans base.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  console.log(
    condition ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(label);
}

class ProbeRollback extends Error {}

/** Pose l'école seule — le chemin du personnel, inchangé depuis la Semaine 1. */
async function asStaff(client: PoolClient, organizationId: string) {
  await client.query("select set_config($1, $2, true)", [
    TENANT_CONTEXT_SETTING,
    organizationId,
  ]);
  await client.query("select set_config($1, $2, true)", [
    FAMILY_CONTEXT_SETTING,
    "",
  ]);
}

/** Pose l'école **et** la famille — le chemin du parent. */
async function asParent(
  client: PoolClient,
  organizationId: string,
  familyId: string,
) {
  await client.query("select set_config($1, $2, true)", [
    TENANT_CONTEXT_SETTING,
    organizationId,
  ]);
  await client.query("select set_config($1, $2, true)", [
    FAMILY_CONTEXT_SETTING,
    familyId,
  ]);
}

async function countOf(client: PoolClient, statement: string, values: unknown[] = []) {
  const { rows } = await client.query(statement, values);
  return Number((rows[0] as { n: string | number }).n);
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

  if (
    !connectionString ||
    !defaults.timezone ||
    !defaults.currency ||
    !defaults.country ||
    !defaults.locale
  ) {
    console.error(
      "\nConfiguration incomplète dans .env.local (DATABASE_URL, DEFAULT_ORGANIZATION_*, NEXT_PUBLIC_SUPPORTED_LOCALES).\n",
    );
    return 1;
  }

  // ── 7. L'adresse non vérifiée ─────────────────────────────────────────────
  //
  // Placé en premier parce que c'est le contrôle le plus important du lot : il
  // ne teste pas une politique de base mais la seule ligne de code qui décide
  // *quelle* famille un visiteur obtient.

  console.log("\nRattachement : uniquement une adresse vérifiée");

  const verified = verifiedEmailsOf({
    emailAddresses: [
      { emailAddress: "Parent@Example.test", verification: { status: "verified" } },
      { emailAddress: "usurpateur@example.test", verification: { status: "unverified" } },
      { emailAddress: "sans-preuve@example.test", verification: null },
    ],
  });

  check(
    "une adresse vérifiée est retenue",
    verified.includes("parent@example.test"),
    verified.join(", "),
  );
  check(
    "une adresse NON vérifiée est écartée",
    !verified.includes("usurpateur@example.test"),
    verified.join(", "),
  );
  check(
    "une adresse sans preuve de vérification est écartée",
    !verified.includes("sans-preuve@example.test"),
  );
  check(
    "la casse est normalisée — « Parent@ » et « parent@ » sont la même personne",
    verified.includes("parent@example.test"),
  );

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  const organizationId = `probe_parent_${crypto.randomUUID()}`;
  const otherOrganizationId = `probe_other_${crypto.randomUUID()}`;

  try {
    await client.query("begin");

    // ── Décor : une école, deux familles, un élève chacune ────────────────
    //
    // Les deux familles sont dans la MÊME école : c'est là que le nouvel axe
    // se joue. L'isolation par école, elle, est déjà prouvée par db:verify.

    await asStaff(client, organizationId);

    for (const id of [organizationId, otherOrganizationId]) {
      await asStaff(client, id);
      await client.query(
        `insert into organization (id, name, timezone, currency, country, supported_languages)
         values ($1, $1, $2, $3, $4, array[$5]::text[])`,
        [id, defaults.timezone, defaults.currency, defaults.country, defaults.locale],
      );
    }

    await asStaff(client, organizationId);

    const mine = (
      await client.query(
        `insert into family (organization_id, primary_guardian_name, email, preferred_language)
         values ($1, 'Sonde — mon foyer', 'moi@example.test', $2) returning id`,
        [organizationId, defaults.locale],
      )
    ).rows[0].id as string;

    const theirs = (
      await client.query(
        `insert into family (organization_id, primary_guardian_name, email, preferred_language)
         values ($1, 'Sonde — autre foyer', 'eux@example.test', $2) returning id`,
        [organizationId, defaults.locale],
      )
    ).rows[0].id as string;

    for (const [familyId, name] of [
      [mine, "Sonde-Mien"],
      [theirs, "Sonde-Autre"],
    ] as const) {
      await client.query(
        `insert into guardian (organization_id, family_id, name, email, preferred_language)
         values ($1, $2, $3, $4, $5)`,
        [organizationId, familyId, name, `${name.toLowerCase()}@example.test`, defaults.locale],
      );
      await client.query(
        `insert into student (organization_id, family_id, first_name, last_name, date_of_birth)
         values ($1, $2, $3, 'Sonde', '2018-01-01')`,
        [organizationId, familyId, name],
      );
    }

    /** Du personnel, et un événement Stripe : la plomberie à rendre invisible. */
    await client.query(
      `insert into staff_user (organization_id, auth_id, email, role)
       values ($1, $2, 'staff@example.test', 'owner')`,
      [organizationId, `user_${crypto.randomUUID()}`],
    );
    const eventId = `probe_evt_${crypto.randomUUID()}`;
    await client.query(`insert into stripe_event (id, type) values ($1, 'probe')`, [
      eventId,
    ]);

    /** Une trace rattachée à l'élève, pour éprouver la politique à sous-requête. */
    const level = (
      await client.query(
        `insert into program (organization_id, name) values ($1, 'Sonde') returning id`,
        [organizationId],
      )
    ).rows[0].id as string;
    const levelId = (
      await client.query(
        `insert into level (organization_id, program_id, name, color, sort_order)
         values ($1, $2, 'Sonde', '#000000', 1) returning id`,
        [organizationId, level],
      )
    ).rows[0].id as string;
    const skillId = (
      await client.query(
        `insert into skill (organization_id, level_id, name, sort_order)
         values ($1, $2, 'Sonde', 1) returning id`,
        [organizationId, levelId],
      )
    ).rows[0].id as string;

    const students = (
      await client.query(
        `select id, family_id from student where organization_id = $1`,
        [organizationId],
      )
    ).rows as { id: string; family_id: string }[];

    for (const row of students) {
      await client.query(
        `insert into skill_progress (organization_id, student_id, skill_id, status, achieved_at)
         values ($1, $2, $3, 'achieved', now())`,
        [organizationId, row.id, skillId],
      );
    }

    // ── L'amorçage : résoudre une famille SANS contexte ───────────────────
    //
    // La seconde exception à la RLS du produit. Elle doit résoudre hors
    // contexte — sinon le portail ne s'ouvre jamais — sans devenir pour autant
    // un annuaire des familles.

    console.log("\nAmorçage : résolution hors contexte de tenant");

    /** Aucun contexte, ni école ni famille : la situation du portail à froid. */
    await client.query("select set_config($1, $2, true)", [
      TENANT_CONTEXT_SETTING,
      "",
    ]);
    await client.query("select set_config($1, $2, true)", [
      FAMILY_CONTEXT_SETTING,
      "",
    ]);

    const blind = await client.query(
      "select count(*)::int n from guardian where lower(email) = $1",
      ["sonde-mien@example.test"],
    );
    check(
      "une lecture ordinaire de guardian ne voit rien hors contexte",
      Number(blind.rows[0].n) === 0,
      `${blind.rows[0].n} — la RLS ne filtre pas`,
    );

    const resolved = await client.query(
      "select organization_id, family_id from resolve_guardian_families($1)",
      [["sonde-mien@example.test"]],
    );
    check(
      "la fonction d'amorçage, elle, résout la famille",
      resolved.rows.length === 1 && resolved.rows[0].family_id === mine,
      `${resolved.rows.length} ligne(s)`,
    );

    /** Contrôle négatif : sans connaître l'adresse, on n'obtient rien. */
    const unknown = await client.query(
      "select count(*)::int n from resolve_guardian_families($1)",
      [["personne@example.test"]],
    );
    check(
      "une adresse inconnue ne rend rien — aucune énumération possible",
      Number(unknown.rows[0].n) === 0,
      `${unknown.rows[0].n}`,
    );

    const empty = await client.query(
      "select count(*)::int n from resolve_guardian_families($1)",
      [[]],
    );
    check(
      "une liste d'adresses vide ne rend rien",
      Number(empty.rows[0].n) === 0,
      `${empty.rows[0].n}`,
    );

    // ── 6. Le contrôle du contrôle ────────────────────────────────────────
    //
    // Avant de prouver un refus, prouver qu'il y a quelque chose à refuser.

    console.log("\nContrôle du contrôle : contexte famille vide, tout est là");

    await asStaff(client, organizationId);

    const staffStudents = await countOf(client, "select count(*) n from student");
    const staffProgress = await countOf(client, "select count(*) n from skill_progress");
    const staffUsers = await countOf(client, "select count(*) n from staff_user");
    const staffEvents = await countOf(
      client,
      "select count(*) n from stripe_event where id = $1",
      [eventId],
    );

    check("le personnel voit les deux élèves", staffStudents === 2, `${staffStudents}`);
    check("le personnel voit les deux progressions", staffProgress === 2, `${staffProgress}`);
    check("le personnel voit le personnel", staffUsers === 1, `${staffUsers}`);
    check("le personnel voit le registre Stripe", staffEvents === 1, `${staffEvents}`);

    // ── 1 & 2. Le parent voit les siens, et rien de l'autre foyer ──────────

    console.log("\nLe parent, dans SA famille");

    await asParent(client, organizationId, mine);

    const ownFamilies = await countOf(client, "select count(*) n from family");
    const ownStudents = await countOf(client, "select count(*) n from student");
    const ownGuardians = await countOf(client, "select count(*) n from guardian");

    check("il voit son foyer, et lui seul", ownFamilies === 1, `${ownFamilies}`);
    check("il voit son enfant, et lui seul", ownStudents === 1, `${ownStudents}`);
    check("il voit son tuteur, et lui seul", ownGuardians === 1, `${ownGuardians}`);

    /** Le `where` visant explicitement l'autre foyer ne doit rien rapporter. */
    const targeted = await countOf(
      client,
      "select count(*) n from family where id = $1",
      [theirs],
    );
    check(
      "viser l'autre foyer par son identifiant ne rapporte rien",
      targeted === 0,
      `${targeted}`,
    );

    // ── 8. La politique à sous-requête ────────────────────────────────────

    console.log("\nLa politique à sous-requête (via l'élève)");

    const ownProgress = await countOf(client, "select count(*) n from skill_progress");
    check(
      "skill_progress est filtré par la sous-requête sur student",
      ownProgress === 1,
      `${ownProgress} au lieu de 1 — la sous-requête ne filtre pas`,
    );

    const otherStudent = students.find((row) => row.family_id === theirs)!;
    const targetedProgress = await countOf(
      client,
      "select count(*) n from skill_progress where student_id = $1",
      [otherStudent.id],
    );
    check(
      "viser la progression de l'autre enfant ne rapporte rien",
      targetedProgress === 0,
      `${targetedProgress}`,
    );

    /** Sans jointure, sans where : la forme la plus brutale possible. */
    const brutal = await countOf(
      client,
      "select count(*) n from skill_progress, student",
    );
    check(
      "un produit cartésien ne fait pas fuiter l'autre foyer",
      brutal === 1,
      `${brutal}`,
    );

    // ── Les deux vues doivent être d'accord ───────────────────────────────
    //
    // La progression d'un enfant est DÉRIVÉE : compétences du niveau au
    // dénominateur, marques acquises au numérateur. Une dérivation ne dépend
    // pas de qui regarde. Si le parent et le personnel voient des totaux
    // différents pour le même enfant, l'un des deux ment — et rien dans
    // l'interface ne dit lequel.
    //
    // Ce contrôle aurait attrapé le bug du portail : il compare les deux
    // lectures au lieu de vérifier chacune dans son coin.

    console.log("\nParent et personnel voient la même progression");

    /** Exactement le calcul de `readStudentProgress`, réduit à ses totaux. */
    async function progressSeenFor(studentId: string) {
      const { rows } = await client.query(
        `select l.id as level_id,
                (select count(*)::int from skill where level_id = l.id) as total,
                (select count(*)::int from skill_progress sp
                   join skill s on s.id = sp.skill_id
                  where s.level_id = l.id
                    and sp.student_id = $1
                    and sp.status = 'achieved') as achieved
           from level l
          where l.organization_id = $2
          order by l.sort_order`,
        [studentId, organizationId],
      );

      return rows as { level_id: string; total: number; achieved: number }[];
    }

    const ownStudent = students.find((row) => row.family_id === mine)!;

    await asStaff(client, organizationId);
    const seenByStaff = await progressSeenFor(ownStudent.id);

    await asParent(client, organizationId, mine);
    const seenByParent = await progressSeenFor(ownStudent.id);

    check(
      "les deux voient le même nombre de niveaux",
      seenByStaff.length === seenByParent.length,
      `personnel ${seenByStaff.length}, parent ${seenByParent.length}`,
    );

    /**
     * Le dénominateur vient de `skill`, jamais de `skill_progress` : un niveau
     * dont l'élève n'a encore rien acquis vaut « 0 sur N », pas « 0 sur 0 ».
     * Le compter depuis les marques ferait disparaître le niveau à mesure qu'il
     * est vide — et un enfant qui commence n'aurait aucun objectif affiché.
     */
    check(
      "aucun niveau n'a un dénominateur nul côté personnel",
      seenByStaff.every((row) => row.total > 0),
      seenByStaff.map((row) => row.total).join(", "),
    );

    const divergent = seenByParent.filter((parentRow, index) => {
      const staffRow = seenByStaff[index];
      return (
        !staffRow ||
        staffRow.level_id !== parentRow.level_id ||
        Number(staffRow.total) !== Number(parentRow.total) ||
        Number(staffRow.achieved) !== Number(parentRow.achieved)
      );
    });

    check(
      "niveau par niveau, les totaux sont identiques",
      divergent.length === 0,
      divergent
        .map((row) => `${row.level_id}: parent ${row.achieved}/${row.total}`)
        .join(" · "),
    );

    /** Contrôle du contrôle : sans données, l'égalité serait vide de sens. */
    check(
      "et il y avait bien quelque chose à comparer",
      seenByParent.some((row) => Number(row.achieved) > 0),
      seenByParent.map((row) => `${row.achieved}/${row.total}`).join(", "),
    );

    // ── 4. La plomberie ───────────────────────────────────────────────────

    await asParent(client, organizationId, mine);


    console.log("\nLa plomberie, invisible au parent");

    const parentStaff = await countOf(client, "select count(*) n from staff_user");
    const parentEvents = await countOf(client, "select count(*) n from stripe_event");

    check("il ne voit aucun membre du personnel", parentStaff === 0, `${parentStaff}`);
    check("il ne voit aucun événement Stripe", parentEvents === 0, `${parentEvents}`);

    // ── 3. L'ancien axe tient toujours ────────────────────────────────────

    console.log("\nL'axe école n'a pas bougé");

    await asParent(client, otherOrganizationId, mine);
    const crossSchool = await countOf(client, "select count(*) n from student");
    check(
      "depuis une autre école, son propre foyer devient invisible",
      crossSchool === 0,
      `${crossSchool}`,
    );

    // ── 5. L'écriture ─────────────────────────────────────────────────────

    console.log("\nL'écriture est bornée par le même prédicat");

    await asParent(client, organizationId, mine);

    /**
     * Point de sauvegarde : un refus de la RLS avorte la transaction entière.
     * Sans lui, le contrôle suivant échouerait en `25P02` — et on prendrait un
     * refus de Postgres pour une preuve, alors qu'il ne dirait plus rien.
     */
    await client.query("savepoint attempted_write");

    const rejected = await client
      .query(
        `insert into student (organization_id, family_id, first_name, last_name, date_of_birth)
         values ($1, $2, 'Intrus', 'Sonde', '2018-01-01')`,
        [organizationId, theirs],
      )
      .then(() => "acceptée")
      .catch((error: { code?: string }) => error.code ?? "refusée");

    await client.query("rollback to savepoint attempted_write");

    check(
      "insérer un élève dans l'autre foyer est refusé",
      rejected !== "acceptée",
      String(rejected),
    );

    const ownInsert = await client
      .query(
        `insert into student (organization_id, family_id, first_name, last_name, date_of_birth)
         values ($1, $2, 'Légitime', 'Sonde', '2018-01-01')`,
        [organizationId, mine],
      )
      .then(() => "acceptée")
      .catch((error: { code?: string }) => error.code ?? "refusée");

    check(
      "insérer dans SON foyer reste possible — le refus vient du prédicat, pas d'un blocage global",
      ownInsert === "acceptée",
      String(ownInsert),
    );

    throw new ProbeRollback();
  } catch (error) {
    if (!(error instanceof ProbeRollback)) {
      const detail = error as { message?: string; detail?: string };
      console.error("\n  erreur :", detail?.message ?? String(error));
      if (detail?.detail) console.error("  détail :", detail.detail);
      failures.push("exécution");
    }
  } finally {
    await client.query("rollback").catch(() => null);
    client.release();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nAccès parent : OK.\n"
      : `\nAccès parent : ÉCHEC — ${failures.length} contrôle(s).\n`,
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
