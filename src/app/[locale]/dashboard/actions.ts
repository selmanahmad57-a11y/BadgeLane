"use server";

import { revalidatePath } from "next/cache";

import { routes } from "@/config/routes";
import { i18nConfig } from "@/config/i18n";
import { EMAIL_BATCH_INTERVAL_MS } from "@/config/email";
import { getMonthlyReports, isReportWorthSending } from "@/db/monthly-report";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { composeMonthlyProgress } from "@/lib/email/compose";
import { isObviouslyUndeliverable } from "@/lib/email/deliverable";
import { sendOnce } from "@/lib/email/outbox";
import { resendAdapter } from "@/lib/email/resend";
import { isValidPeriod, previousCivilMonth } from "@/lib/reporting-period";
import { todayInTimeZone } from "@/lib/occurrences";
import type { ActionResult } from "@/lib/action-result";
import { runAuthorizedAction, ValidationError } from "@/lib/actions";

/**
 * Envoie les rapports de progression d'un mois.
 *
 * ── Pourquoi une action, et non un script ───────────────────────────────────
 *
 * La première version était un script prenant l'école en argument de ligne de
 * commande. `server-only` l'a bloquée — et c'était un barreau, pas un
 * obstacle : un tel script écrit massivement dans **n'importe quelle** école
 * choisie par **quiconque** le lance. Aucun principal, aucune capacité, aucun
 * contexte dérivé d'une session.
 *
 * Sa propre sortie annonçait « l'école n'est jamais devinée » — et elle la
 * devinait depuis `argv`, exactement la garde que tout le reste du produit
 * refuse. Écrire à toutes les familles d'une école est l'opération la plus
 * puissante de BadgeLane et la seule dont l'effet ne s'annule pas : elle ne
 * pouvait pas être la seule sans authentification.
 *
 * L'école vient donc de la **session**, et la capacité `communications:send`
 * décide qui peut la déclencher.
 *
 * ── Tolérante au délai, gratuitement ────────────────────────────────────────
 *
 * Cent familles à intervalle régulier dépasseront le temps imparti à une
 * exécution. Ce n'est pas un problème : un délai dépassé n'est qu'un plantage
 * de plus, et la règle de reprise le rattrape. `accepted` est acquis et se
 * saute, `claimed` se rejoue — relancer reprend où l'on s'était arrêté.
 *
 * C'est ce qui permet de s'en tenir au déclenchement manuel aujourd'hui. Le
 * travail de fond viendra avec le cron de production.
 */
export async function sendMonthlyReports(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("communications:send", async (context) => {
    const adapter = resendAdapter();

    if (!adapter) {
      throw new ValidationError(
        "Aucun envoi configuré sur cette instance.",
        "stripeNotConfigured",
      );
    }

    const { rows } = await db.execute(
      sql`select "timezone" from "organization" where "id" = ${context.organizationId}`,
    );
    const timezone = (rows[0] as { timezone?: string })?.timezone;

    if (!timezone) {
      throw new ValidationError("École introuvable.", "notInThisSchool");
    }

    /**
     * La période est une DÉCISION, avec le dernier mois révolu pour défaut.
     * Jamais déduite de l'horloge au moment de l'envoi : c'est ce qui permet
     * de rejouer un mois précis, et ce qui supprime le bord des mois de
     * longueurs différentes.
     */
    const requested = String(formData.get("period") ?? "").trim();
    const period = requested || previousCivilMonth(todayInTimeZone(timezone));

    if (!isValidPeriod(period)) {
      throw new ValidationError("Période invalide.", "invalidPeriod");
    }

    const reports = (
      await getMonthlyReports(context.organizationId, period)
    ).filter(isReportWorthSending);

    for (const report of reports) {
      if (!report.recipient || isObviouslyUndeliverable(report.recipient)) {
        continue;
      }

      const locale = (
        (i18nConfig.locales as readonly string[]).includes(
          report.preferredLanguage,
        )
          ? report.preferredLanguage
          : i18nConfig.defaultLocale
      ) as "en" | "es";

      /**
       * Réclamation ENTRELACÉE avec l'envoi, famille par famille. Une
       * pré-réclamation en masse changerait un plantage précoce en centaines
       * de rapports fantômes.
       */
      await sendOnce(
        {
          organizationId: context.organizationId,
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
              .flatMap((child) =>
                child.badges.length > 0
                  ? child.badges.map(
                      (badge) =>
                        `  • ${child.firstName} — badge earned: ${badge.name}`,
                    )
                  : [
                      `  • ${child.firstName} — ${child.skillsAchieved} new skills`,
                    ],
              )
              .join("\n"),
          }),
      );

      /** Espacer plutôt que se faire refuser au milieu de la rafale. */
      await new Promise((resolve) =>
        setTimeout(resolve, EMAIL_BATCH_INTERVAL_MS),
      );
    }

    revalidatePath(`/[locale]${routes.dashboard}`, "page");
  });
}
