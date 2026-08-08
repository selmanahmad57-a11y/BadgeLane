import { neonConfig, Pool } from "@neondatabase/serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

import {
  effectiveRecipient,
  emailConfigurationProblems,
} from "../src/config/email-guard";

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
