import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

import { EMAIL_DELIVERY_STATUSES } from "../src/config/email";
import {
  effectiveRecipient,
  emailConfigurationProblems,
} from "../src/config/email-guard";
import { isObviouslyUndeliverable } from "../src/lib/email/deliverable";
import {
  isValidPeriod,
  previousCivilMonth,
} from "../src/lib/reporting-period";

/**
 * Éprouve les deux garanties de l'envoi : ne jamais partir deux fois, et ne
 * jamais partir à la mauvaise personne.
 *
 * ── Pourquoi l'idempotence ne se teste pas contre Resend ────────────────────
 *
 * « Le même paiement livré deux fois ne produit qu'un e-mail » est une
 * propriété de NOTRE enchaînement — réclamer, valider, puis envoyer — pas du
 * réseau du fournisseur. La prouver contre un vrai envoi la rendrait lente,
 * dépendante d'un tiers, et finalement désactivée.
 *
 * Ce qui reste au fournisseur, c'est la fenêtre que la base ne peut pas
 * fermer : envoi réussi, processus mort avant le `commit`. Elle se ferme par la
 * clé d'idempotence transmise, et se vérifie chez Resend, pas ici.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  console.log(
    condition ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(label);
}

async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  console.log("\nLe garde-fou contre l'envoi irréversible");

  check(
    "une clé d'envoi hors production sans adresse de test : démarrage REFUSÉ",
    emailConfigurationProblems({
      resendApiKey: "re_test",
      emailFrom: "a@b.test",
      emailTestRecipient: undefined,
      isProduction: false,
    }).some((problem) => problem.field === "EMAIL_TEST_RECIPIENT"),
  );
  check(
    "une clé d'envoi sans expéditeur : démarrage REFUSÉ",
    emailConfigurationProblems({
      resendApiKey: "re_test",
      emailFrom: undefined,
      emailTestRecipient: "moi@test.dev",
      isProduction: false,
    }).some((problem) => problem.field === "EMAIL_FROM"),
  );
  check(
    "sans clé d'envoi, rien à border",
    emailConfigurationProblems({
      resendApiKey: undefined,
      emailFrom: undefined,
      emailTestRecipient: undefined,
      isProduction: false,
    }).length === 0,
  );
  check(
    "hors production, TOUT part vers l'adresse de test",
    effectiveRecipient("parent@ecole.test", {
      emailTestRecipient: "moi@test.dev",
      isProduction: false,
    }) === "moi@test.dev",
  );
  check(
    "en production, le destinataire calculé est respecté",
    effectiveRecipient("parent@ecole.test", {
      emailTestRecipient: "moi@test.dev",
      isProduction: true,
    }) === "parent@ecole.test",
  );

  console.log("\nLa période est une décision, pas une lecture d'horloge");

  check(
    "le 1er septembre, le mois révolu est août",
    previousCivilMonth("2026-09-01") === "2026-08",
    previousCivilMonth("2026-09-01"),
  );
  /**
   * Le bord que `now() - interval '1 month'` rate : lancé le 31 août, il rend
   * le 31 juillet, donc juillet — alors que le dernier mois RÉVOLU est bien
   * juillet aussi, mais pour une autre raison. Le piège apparaît sur les mois
   * de longueurs différentes : le 31 mars, l'intervalle saute février.
   */
  check(
    "le 31 mars ne saute pas février",
    previousCivilMonth("2026-03-31") === "2026-02",
    previousCivilMonth("2026-03-31"),
  );
  check(
    "janvier renvoie au décembre de l'année précédente",
    previousCivilMonth("2026-01-15") === "2025-12",
    previousCivilMonth("2026-01-15"),
  );
  check(
    "une période mal formée est refusée",
    !isValidPeriod("2026-13") && !isValidPeriod("aout") && isValidPeriod("2026-08"),
  );

  console.log("\nUn statut n'affirme que ce qu'il a observé");

  check(
    "une adresse en .invalid est reconnue indélivrable",
    isObviouslyUndeliverable("demo.luis@badgelane.invalid"),
  );
  check(
    "une adresse sans arobase aussi",
    isObviouslyUndeliverable("pas-une-adresse"),
  );
  check(
    "une vraie adresse passe",
    !isObviouslyUndeliverable("ana@riverside-swim.com"),
  );
  check(
    "« sent » n'existe plus : le fournisseur accepte, il ne livre pas",
    !(EMAIL_DELIVERY_STATUSES as readonly string[]).includes("sent") &&
      (EMAIL_DELIVERY_STATUSES as readonly string[]).includes("accepted"),
    EMAIL_DELIVERY_STATUSES.join(", "),
  );

  console.log("\nLa devise vient de la FACTURE, la langue du tuteur");

  /**
   * La sonde fournit des entrées de production — un code devise, une locale —
   * et laisse le formateur produire la sortie. Écrire « $240.00 » à la main
   * court-circuiterait précisément le code sous test : une sonde prouve le
   * tuyau et ment sur l'eau.
   */
  const money = (locale: string, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(240);

  check(
    "facture en EUR, reçu en anglais : la devise reste l'euro",
    money("en", "EUR").includes("€"),
    money("en", "EUR"),
  );
  check(
    "facture en USD, reçu en espagnol : la devise reste le dollar",
    money("es", "USD").includes("US$") || money("es", "USD").includes("$"),
    money("es", "USD"),
  );
  /**
   * Ce qui doit être invariant, c'est la DEVISE — pas la mise en forme. Le
   * séparateur décimal et la place du symbole changent avec la langue, et
   * c'est précisément le travail de la langue.
   */
  check(
    "changer de langue ne redénomine jamais un montant",
    ["en", "es", "fr"].every((locale) => money(locale, "EUR").includes("€")),
    ["en", "es", "fr"].map((locale) => money(locale, "EUR")).join(" / "),
  );

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("\nDATABASE_URL absente.\n");
    return 1;
  }

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  const organizationId = `probe_comms_${crypto.randomUUID()}`;
  const invoiceId = crypto.randomUUID();

  try {
    console.log("\nRéclamer avant d'envoyer : le rejeu ne produit rien");

    await client.query("begin");
    await client.query("select set_config('app.current_org_id',$1,true)", [organizationId]);
    await client.query(
      `insert into organization (id, name, timezone, currency, country, supported_languages)
       values ($1, $1, $2, $3, $4, array[$5]::text[])`,
      [
        organizationId,
        process.env.DEFAULT_ORGANIZATION_TIMEZONE,
        process.env.DEFAULT_ORGANIZATION_CURRENCY,
        process.env.DEFAULT_ORGANIZATION_COUNTRY,
        (process.env.NEXT_PUBLIC_SUPPORTED_LOCALES ?? "en").split(",")[0],
      ],
    );

    /** Chaque « livraison » du même événement tente sa réclamation. */
    const claim = async () => {
      await client.query("savepoint attempt");
      const outcome = await client
        .query(
          `insert into outbound_email (organization_id, kind, subject_id, period, recipient)
           values ($1, 'payment_confirmation', $2, '', 'parent@example.test')`,
          [organizationId, invoiceId],
        )
        .then(() => "réclamé")
        .catch((error: { code?: string }) =>
          error.code === "23505" ? "déjà réclamé" : `erreur ${error.code}`,
        );
      await client.query("rollback to savepoint attempt");
      return outcome;
    };

    const first = await claim();
    /** La première réclamation doit persister pour que la seconde bute dessus. */
    await client.query(
      `insert into outbound_email (organization_id, kind, subject_id, period, recipient)
       values ($1, 'payment_confirmation', $2, '', 'parent@example.test')`,
      [organizationId, invoiceId],
    );
    const second = await claim();

    check("la première livraison réclame l'envoi", first === "réclamé", first);
    check(
      "la seconde livraison du MÊME paiement est refusée",
      second === "déjà réclamé",
      second,
    );

    const rows = Number(
      (
        await client.query(
          "select count(*)::int n from outbound_email where subject_id = $1",
          [invoiceId],
        )
      ).rows[0].n,
    );
    check("une seule ligne d'envoi existe", rows === 1, `${rows}`);

    /**
     * LE contrôle qui documente le piège. `period` vaut la chaîne vide, jamais
     * `null` : une contrainte d'unicité IGNORE les `null`, donc deux
     * confirmations pour la même facture passeraient côte à côte sans rien
     * violer. La garde serait présente et inopérante.
     */
    await client.query("savepoint null_period");
    const withNull = await client
      .query(
        `insert into outbound_email (organization_id, kind, subject_id, period, recipient)
         values ($1, 'payment_confirmation', $2, '', 'autre@example.test')`,
        [organizationId, invoiceId],
      )
      .then(() => "acceptée")
      .catch((error: { code?: string }) => error.code ?? "refusée");
    await client.query("rollback to savepoint null_period");

    check(
      "un second envoi, même sujet et même période, est refusé",
      withNull === "23505",
      String(withNull),
    );

    /** Une autre période, elle, doit passer : la clé n'est pas trop large. */
    await client.query("savepoint other_period");
    const otherPeriod = await client
      .query(
        `insert into outbound_email (organization_id, kind, subject_id, period, recipient)
         values ($1, 'monthly_progress', $2, '2026-10', 'parent@example.test')`,
        [organizationId, invoiceId],
      )
      .then(() => "acceptée")
      .catch((error: { code?: string }) => error.code ?? "refusée");
    await client.query("rollback to savepoint other_period");

    check(
      "une autre nature et une autre période restent possibles",
      otherPeriod === "acceptée",
      String(otherPeriod),
    );

    // ── La reprise se pilote par le STATUT, jamais par l'existence ────────
    //
    // Le cycle est réclamer → envoyer → marquer. Un plantage ENTRE les deux
    // laisse une ligne `claimed` dont rien n'est parti. Sauter toute ligne
    // présente condamnerait cette famille à ne jamais recevoir son rapport —
    // sans erreur, sans trace. C'est le trou silencieux d'un traitement par
    // lot, et le pire de tous.

    console.log("\nReprise après plantage : statut, pas existence");

    const reportSubject = crypto.randomUUID();

    /** Deux familles : l'une servie, l'autre réclamée puis interrompue. */
    await client.query(
      `insert into outbound_email (organization_id, kind, subject_id, period, recipient, status, sent_at)
       values ($1, 'monthly_progress', $2, '2026-08', 'servie@example.test', 'accepted', now())`,
      [organizationId, reportSubject],
    );

    const interrupted = crypto.randomUUID();
    await client.query(
      `insert into outbound_email (organization_id, kind, subject_id, period, recipient, status)
       values ($1, 'monthly_progress', $2, '2026-08', 'interrompue@example.test', 'claimed')`,
      [organizationId, interrupted],
    );

    const statusOf = async (subject: string) =>
      (
        await client.query(
          "select status from outbound_email where subject_id = $1 and period = '2026-08'",
          [subject],
        )
      ).rows[0]?.status;

    check(
      "la famille servie porte « accepted »",
      (await statusOf(reportSubject)) === "accepted",
    );
    check(
      "la famille interrompue porte « claimed » — rien n'est parti",
      (await statusOf(interrupted)) === "claimed",
    );

    /**
     * La règle de reprise, exprimée telle que le lot l'applique : on saute
     * `accepted`, on rejoue tout le reste.
     */
    const toReplay = (
      await client.query(
        `select subject_id from outbound_email
          where period = '2026-08' and kind = 'monthly_progress'
            and status <> 'accepted'`,
      )
    ).rows.map((row) => row.subject_id as string);

    check(
      "la reprise rejoue la famille interrompue",
      toReplay.includes(interrupted),
      toReplay.length + " à rejouer",
    );
    check(
      "et ne rejoue PAS la famille déjà servie",
      !toReplay.includes(reportSubject),
    );

    /**
     * Contrôle du contrôle : une reprise pilotée par l'EXISTENCE sauterait les
     * deux — et la famille interrompue ne recevrait jamais rien.
     */
    const byExistence = (
      await client.query(
        `select subject_id from outbound_email
          where period = '2026-08' and kind = 'monthly_progress'`,
      )
    ).rows.length;

    check(
      "piloter par l'existence sauterait AUSSI l'interrompue — le trou silencieux",
      byExistence === 2 && toReplay.length === 1,
      `${byExistence} lignes, ${toReplay.length} à rejouer`,
    );

    await client.query("rollback");
  } catch (error) {
    console.error("\n  erreur :", (error as Error).message);
    failures.push("exécution");
    await client.query("rollback").catch(() => null);
  } finally {
    client.release();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nCommunications : OK.\n"
      : `\nCommunications : ÉCHEC — ${failures.length} contrôle(s).\n`,
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
