import { getTranslations, setRequestLocale } from "next-intl/server";

import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganizationSession } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { can } from "@/config/permissions";
import { getEnrollmentsToReview, getSchoolSummary } from "@/db/queries";

import { Input } from "@/components/ui/input";

import {
  endEnrollment,
  markEnrollmentReviewed,
} from "../schedule/enrollment-actions";
import { sendMonthlyReports } from "./actions";

type DashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  /**
   * Résout la session, exige une école sélectionnée et réconcilie Clerk avec
   * Postgres. Tout ce qui suit lit des données déjà filtrées par le tenant.
   */
  const session = await requireOrganizationSession(locale);

  const t = await getTranslations("dashboard");
  const roleLabels = await getTranslations("roles");

  /**
   * La file de revue : les inscriptions venues des familles, pas encore
   * traitées. Elle vit sur le tableau de bord parce que c'est la première
   * page que l'école ouvre — un signal qu'il faut aller chercher n'est pas un
   * signal.
   */
  const toReview = can(session.staffUser.role, "schedule:write")
    ? await getEnrollmentsToReview(session.organization.id)
    : [];

  const summary = await getSchoolSummary(session.organization.id);

  const facts = [
    { label: t("schoolLabel"), value: session.organization.name },
    { label: t("roleLabel"), value: roleLabels(session.staffUser.role) },
    { label: t("timezoneLabel"), value: session.organization.timezone },
    { label: t("currencyLabel"), value: session.organization.currency },
  ];

  return (
    <ConsoleShell
      title={t("heading")}
      description={t("welcome", { name: session.fullName ?? session.email })}
    >
      {toReview.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("reviewHeading", { count: toReview.length })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm text-pretty">
              {t("reviewBody")}
            </p>

            <ul className="flex flex-col gap-3">
              {toReview.map((entry) => {
                /**
                 * L'écart de niveau, rendu visible sans faire comparer des
                 * noms : un débutant inscrit dans un cours avancé se repère
                 * d'un coup d'œil. Le rang sert de mesure, pas le libellé.
                 */
                const mismatch =
                  entry.studentLevelSort !== null &&
                  entry.klassLevelSort !== null &&
                  entry.studentLevelSort !== entry.klassLevelSort;

                return (
                  <li
                    key={entry.id}
                    className="ring-foreground/10 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 ring-1"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium">
                        {entry.studentName} → {entry.klassTitle}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block">
                        {t("reviewLevels", {
                          child: entry.studentLevelName ?? t("reviewNoLevel"),
                          klass: entry.klassLevelName ?? t("reviewNoLevel"),
                        })}
                        {entry.guardianName ? ` · ${entry.guardianName}` : ""}
                      </span>
                    </span>

                    <span className="flex flex-wrap items-center gap-2">
                      {mismatch ? (
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                          {t("reviewMismatch")}
                        </span>
                      ) : null}

                      {/*
                        Le signal mène à l'action : retirer est précisément le
                        pouvoir refusé au parent, et l'école doit pouvoir
                        l'exercer d'ici plutôt que d'aller le chercher ailleurs.
                      */}
                      <ActionForm
                        action={markEnrollmentReviewed}
                        submitLabel={t("reviewAccept")}
                        size="sm"
                      >
                        <input type="hidden" name="enrollmentId" value={entry.id} />
                      </ActionForm>

                      <ActionForm
                        action={endEnrollment}
                        submitLabel={t("reviewRemove")}
                        size="sm"
                      >
                        <input type="hidden" name="enrollmentId" value={entry.id} />
                      </ActionForm>
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((fact) => (
          <Card key={fact.label}>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {fact.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dd className="truncate text-lg font-medium">{fact.value}</dd>
            </CardContent>
          </Card>
        ))}
      </dl>

      {/*
        Un résumé réel, à la place d'un bandeau « rien à afficher » écrit en
        Semaine 1 et devenu faux dès la Semaine 3. Un écran qui affirme une
        chose que les données démentent apprend à ne pas lire ce qui est écrit.
      */}
      {can(session.staffUser.role, "communications:send") ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("reportsHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActionForm
              action={sendMonthlyReports}
              submitLabel={t("reportsSend")}
              size="sm"
            >
              <Input
                name="period"
                placeholder={t("reportsPeriodPlaceholder")}
                aria-label={t("reportsPeriod")}
                className="w-full sm:w-32"
              />
            </ActionForm>
            {/*
              La reprise rend le lot tolérant au délai : une exécution
              interrompue se relance sans rien doubler ni rien perdre.
            */}
            <p className="text-muted-foreground text-sm text-pretty">
              {t("reportsNote")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("summaryHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-muted-foreground">{t("summaryFamilies")}</dt>
            <dd>{t("summaryFamiliesValue", { families: summary.families, students: summary.students })}</dd>

            <dt className="text-muted-foreground">{t("summaryEnrollments")}</dt>
            <dd>
              {t("summaryEnrollmentsValue", {
                active: summary.activeEnrollments,
                waitlisted: summary.waitlisted,
              })}
            </dd>

            <dt className="text-muted-foreground">{t("summaryOutstanding")}</dt>
            <dd>
              {summary.currency
                ? new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: summary.currency,
                  }).format(summary.outstanding / 100)
                : "—"}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </ConsoleShell>
  );
}
