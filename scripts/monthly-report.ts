import { config as loadEnvFile } from "dotenv";

/**
 * Envoie les rapports de progression d'un mois.
 *
 * ── Déclenché à la main, tant que la production n'est pas joignable ─────────
 *
 *   npm run report:monthly -- <organizationId> [YYYY-MM]
 *
 * La période est un ARGUMENT, avec le dernier mois révolu pour défaut. Elle
 * n'est jamais déduite de l'horloge : c'est ce qui permet de rejouer un mois
 * précis, et ce qui supprime le bord des mois de longueurs différentes.
 *
 * ── La reprise se pilote par le STATUT ──────────────────────────────────────
 *
 * `accepted` est acquis et se saute ; `claimed` et `failed` se rejouent. Un
 * plantage entre la réclamation et l'envoi laisse une ligne `claimed` dont rien
 * n'est parti — sauter toute ligne présente condamnerait cette famille à ne
 * jamais recevoir son rapport, sans erreur ni trace.
 *
 * Et la réclamation est ENTRELACÉE avec l'envoi, famille par famille. Une
 * pré-réclamation en masse transformerait un plantage précoce en centaines de
 * rapports fantômes.
 */

async function main(): Promise<number> {
  loadEnvFile({ path: ".env.local", quiet: true });

  const [organizationId, requestedPeriod] = process.argv.slice(2);

  if (!organizationId) {
    console.error(
      "\nUsage : npm run report:monthly -- <organizationId> [YYYY-MM]\n" +
        "L'école n'est jamais devinée — écrire à des familles est irréversible.\n",
    );
    return 1;
  }

  /** Imports différés : la configuration client valide au chargement. */
  const { getMonthlyReports, isReportWorthSending } = await import(
    "../src/db/monthly-report"
  );
  const { composeMonthlyProgress } = await import("../src/lib/email/compose");
  const { sendOnce } = await import("../src/lib/email/outbox");
  const { resendAdapter } = await import("../src/lib/email/resend");
  const { isObviouslyUndeliverable } = await import(
    "../src/lib/email/deliverable"
  );
  const { previousCivilMonth, isValidPeriod } = await import(
    "../src/lib/reporting-period"
  );
  const { todayInTimeZone } = await import("../src/lib/occurrences");
  const { i18nConfig } = await import("../src/config/i18n");
  const {
    EMAIL_BATCH_INTERVAL_MS,
    EMAIL_FREE_TIER_DAILY_LIMIT,
  } = await import("../src/config/email");
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  const { rows } = await db.execute(
    sql`select "timezone", "name" from "organization" where "id" = ${organizationId}`,
  );
  const school = rows[0] as { timezone?: string; name?: string } | undefined;

  if (!school?.timezone) {
    console.error(`\nÉcole « ${organizationId} » introuvable.\n`);
    return 1;
  }

  const period =
    requestedPeriod ?? previousCivilMonth(todayInTimeZone(school.timezone));

  if (!isValidPeriod(period)) {
    console.error(`\nPériode « ${period} » invalide — attendu YYYY-MM.\n`);
    return 1;
  }

  const adapter = resendAdapter();

  if (!adapter) {
    console.error("\nAucun envoi configuré : RESEND_API_KEY absente.\n");
    return 1;
  }

  const reports = await getMonthlyReports(organizationId, period);
  const worth = reports.filter(isReportWorthSending);

  console.log(`\nÉcole   : ${school.name} (${school.timezone})`);
  console.log(`Période : ${period}${requestedPeriod ? "" : "  (dernier mois révolu)"}`);
  console.log(`Familles: ${reports.length}, dont ${worth.length} avec des progrès à raconter`);

  /**
   * Le palier est annoncé AVANT de commencer. Un refus de facturation au
   * milieu d'une rafale laisse la moitié des parents sans nouvelles, et
   * personne ne sait laquelle.
   */
  if (worth.length > EMAIL_FREE_TIER_DAILY_LIMIT) {
    console.log(
      `\n⚠ ${worth.length} envois > palier gratuit de ${EMAIL_FREE_TIER_DAILY_LIMIT}/jour.\n` +
        `  Le lot sera refusé en cours de route. Passe le compte Resend en Pro avant de relancer.`,
    );
  }

  let accepted = 0;
  let skipped = 0;
  let failed = 0;

  console.log("");

  for (const report of worth) {
    if (!report.recipient || isObviouslyUndeliverable(report.recipient)) {
      console.log(`  — ${report.guardianName.padEnd(28)} adresse indélivrable`);
      skipped += 1;
      continue;
    }

    const locale = (
      (i18nConfig.locales as readonly string[]).includes(report.preferredLanguage)
        ? report.preferredLanguage
        : i18nConfig.defaultLocale
    ) as "en" | "es";

    const outcome = await sendOnce(
      {
        organizationId,
        kind: "monthly_progress",
        subjectId: report.familyId,
        period,
        recipient: report.recipient,
      },
      adapter,
      () =>
        composeMonthlyProgress(locale, {
          guardian: report.guardianName,
          child: report.children[0]?.firstName ?? "",
          school: report.schoolName,
          achievements: report.children
            .flatMap((child) => [
              ...child.badges.map(
                (badge) => `  • ${child.firstName} — badge earned: ${badge.name}`,
              ),
              ...(child.badges.length === 0 && child.skillsAchieved > 0
                ? [`  • ${child.firstName} — ${child.skillsAchieved} new skills`]
                : []),
            ])
            .join("\n"),
        }),
    );

    if (outcome === "accepted") accepted += 1;
    else if (outcome === "already_handled") skipped += 1;
    else failed += 1;

    console.log(`  ${outcome === "accepted" ? "✓" : outcome === "already_handled" ? "·" : "✗"} ${report.guardianName.padEnd(28)} ${outcome}`);

    /** Le débit : espacer plutôt que se faire refuser au milieu. */
    await new Promise((resolve) => setTimeout(resolve, EMAIL_BATCH_INTERVAL_MS));
  }

  console.log(
    `\n${accepted} accepté(s), ${skipped} sauté(s), ${failed} en échec.` +
      `\n${reports.length - worth.length} famille(s) sans progrès ce mois-ci — aucun e-mail vide envoyé.\n`,
  );

  return failed === 0 ? 0 : 1;
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
