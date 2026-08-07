import { neonConfig, Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { config as loadEnvFile } from "dotenv";
import ws from "ws";

import {
  isRecurringInterval,
  STRIPE_RECURRING_INTERVAL,
  TERM_INVOICE_DAYS_UNTIL_DUE,
  TUITION_INTERVALS,
} from "../src/config/billing";
import {
  TENANT_CONTEXT_SETTING,
  UNIQUE_VIOLATION_SQLSTATE,
} from "../src/config/database";
import { isUniqueViolation } from "../src/db/errors";

/**
 * Éprouve les deux mécanismes du webhook Stripe qui ne se relisent pas.
 *
 * ── 1. LA RECONNAISSANCE DU DOUBLON ──────────────────────────────────────────
 *
 * Stripe retente ; le même événement arrive plusieurs fois. La clé primaire de
 * `stripe_event` rend le doublon impossible — ça, une relecture le montre. Ce
 * qu'elle ne montre pas, c'est **la forme de l'erreur levée**.
 *
 * Drizzle ré-emballe l'erreur du pilote : le SQLSTATE n'est plus à la racine
 * mais au bout de la chaîne `cause`. Un `error.code === "23505"` écrit de bonne
 * foi est donc toujours faux, en silence. C'est le bug qu'on a eu : le rejeu
 * répondait 500 au lieu de 200, la contrainte tenant bon mais le doublon
 * n'étant pas reconnu. Stripe aurait retenté sans fin, puis désactivé
 * l'endpoint — une panne de facturation invisible dans les logs applicatifs.
 *
 * Le test lève donc une **vraie** erreur, à travers la **vraie** pile, et
 * vérifie en plus que la lecture naïve échoue : sans ce second contrôle, le
 * test passerait encore le jour où quelqu'un « simplifierait » le helper.
 *
 * ── 2. LA VUE QUI ÉCHAPPE À LA RLS ───────────────────────────────────────────
 *
 * `stripe_account_lookup` doit répondre sans contexte de tenant — c'est sa
 * raison d'être. Le contrôle négatif interroge la même donnée par la table
 * sous-jacente, qui elle doit rester muette. Une vue devenue `security_invoker`
 * par mégarde passerait le contrôle de structure de `db:verify` tout en cassant
 * le webhook : seul le comportement le dit.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  console.log(
    condition ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(label);
}

/** Annule la sonde sans rien laisser derrière elle. */
class ProbeRollback extends Error {}

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

  neonConfig.webSocketConstructor =
    globalThis.WebSocket ?? (ws as unknown as typeof globalThis.WebSocket);

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    console.log("\nAbonnement et facture ponctuelle ne se confondent pas");

    /**
     * Si `term` rejoignait un jour `STRIPE_RECURRING_INTERVAL`, le code créerait
     * un abonnement trimestriel là où l'école attend un paiement unique — et il
     * se reconduirait chaque trimestre, sans que personne l'ait demandé, jusqu'à
     * ce qu'un parent s'en aperçoive sur son relevé. Rien dans l'interface ne le
     * montrerait. D'où ce contrôle.
     */
    for (const interval of TUITION_INTERVALS) {
      const recurring = isRecurringInterval(interval);
      check(
        `« ${interval} » : ${recurring ? "abonnement" : "facture ponctuelle"}`,
        recurring === (interval !== "term"),
      );
    }

    check(
      "aucun intervalle récurrent ne se réclame de « term »",
      !Object.keys(STRIPE_RECURRING_INTERVAL).includes("term"),
      Object.keys(STRIPE_RECURRING_INTERVAL).join(", "),
    );

    /** Le délai de paiement doit rester une durée utilisable par Stripe. */
    check(
      "le délai de paiement d'une facture est un entier positif",
      Number.isInteger(TERM_INVOICE_DAYS_UNTIL_DUE) &&
        TERM_INVOICE_DAYS_UNTIL_DUE > 0,
      String(TERM_INVOICE_DAYS_UNTIL_DUE),
    );

    console.log("\nReconnaissance du doublon d'événement");

    /**
     * Deux insertions du même identifiant dans une seule transaction : la
     * seconde heurte la clé primaire. La transaction est annulée par le rejet,
     * donc rien n'est écrit.
     */
    const eventId = `probe_evt_${crypto.randomUUID()}`;
    let duplicateError: unknown;

    try {
      await db.transaction(async (tx) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await tx.execute(
            sql`insert into stripe_event (id, type) values (${eventId}, ${"probe"})`,
          );
        }
      });
    } catch (error) {
      duplicateError = error;
    }

    check(
      "insérer deux fois le même événement lève une erreur",
      duplicateError !== undefined,
    );
    check(
      "l'erreur est reconnue comme une violation d'unicité",
      isUniqueViolation(duplicateError),
    );

    /**
     * LE CONTRÔLE QUI DOCUMENTE LE BUG. Si cette ligne échoue un jour, c'est que
     * Drizzle a cessé d'emballer — et le helper peut alors être simplifié en
     * connaissance de cause, pas par supposition.
     */
    check(
      "le SQLSTATE n'est PAS à la racine : la lecture naïve aurait échoué",
      (duplicateError as { code?: string })?.code !== UNIQUE_VIOLATION_SQLSTATE,
      `code racine = ${String((duplicateError as { code?: string })?.code)}`,
    );

    const survived = await db.execute(
      sql`select count(*)::int as n from stripe_event where id = ${eventId}`,
    );
    check(
      "la transaction annulée ne laisse aucune ligne",
      (survived.rows[0] as { n: number }).n === 0,
    );

    console.log("\nContrôles négatifs : le helper doit savoir dire non");

    /** Une autre défaillance Postgres doit faire retenter Stripe, pas répondre 200. */
    let notNullError: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`insert into stripe_event (id, type) values (${`probe_evt_${crypto.randomUUID()}`}, null)`,
        );
      });
    } catch (error) {
      notNullError = error;
    }

    check(
      "une violation de non-nullité n'est pas prise pour un doublon",
      notNullError !== undefined && !isUniqueViolation(notNullError),
    );
    check(
      "une erreur applicative ordinaire n'est pas prise pour un doublon",
      !isUniqueViolation(new Error("panne réseau")),
    );
    check("une valeur nulle n'est pas prise pour un doublon", !isUniqueViolation(null));

    /** L'erreur brute du pilote, non emballée, doit rester reconnue. */
    check(
      "le SQLSTATE à la racine reste reconnu",
      isUniqueViolation({ code: UNIQUE_VIOLATION_SQLSTATE }),
    );

    /** Une chaîne `cause` circulaire ne doit pas figer le processus. */
    const cyclic: { code?: string; cause?: unknown } = {};
    cyclic.cause = cyclic;
    check("une chaîne de causes circulaire termine", !isUniqueViolation(cyclic));

    console.log("\nVue de résolution du compte connecté");

    const organizationId = `probe_billing_${crypto.randomUUID()}`;
    const accountId = `acct_probe_${crypto.randomUUID()}`;

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config(${TENANT_CONTEXT_SETTING}, ${organizationId}, true)`,
        );
        await tx.execute(
          sql`insert into organization
                (id, name, timezone, currency, country, supported_languages, stripe_account_id)
              values (${organizationId}, ${organizationId}, ${defaults.timezone},
                      ${defaults.currency}, ${defaults.country},
                      array[${defaults.locale}]::text[], ${accountId})`,
        );

        /** Le webhook n'a pas de session : on retire le contexte de tenant. */
        await tx.execute(
          sql`select set_config(${TENANT_CONTEXT_SETTING}, ${""}, true)`,
        );

        const fromView = await tx.execute(
          sql`select organization_id from stripe_account_lookup
              where stripe_account_id = ${accountId}`,
        );
        check(
          "sans contexte de tenant, la vue résout le compte",
          (fromView.rows[0] as { organization_id?: string })?.organization_id ===
            organizationId,
          `${fromView.rows.length} ligne(s)`,
        );

        /** Contrôle négatif : même donnée, par la table — la RLS doit la masquer. */
        const fromTable = await tx.execute(
          sql`select id from organization where id = ${organizationId}`,
        );
        check(
          "sans contexte de tenant, la table reste muette",
          fromTable.rows.length === 0,
          `${fromTable.rows.length} ligne(s) — la RLS ne filtre plus`,
        );

        throw new ProbeRollback();
      });
    } catch (error) {
      if (!(error instanceof ProbeRollback)) throw error;
    }
  } catch (error) {
    console.error("\n  erreur :", (error as Error)?.message ?? String(error));
    return 1;
  } finally {
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nFacturation : OK.\n"
      : `\nFacturation : ÉCHEC — ${failures.length} contrôle(s).\n`,
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
