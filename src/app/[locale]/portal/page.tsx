import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portalStudentPath } from "@/config/routes";
import {
  getPortalChildren,
  getPortalClasses,
  getPortalEnrollments,
  getPortalBilling,
  getPortalMakeups,
  getPortalFamilyLabel,
  getPortalSchool,
} from "@/db/portal-queries";
import { Link } from "@/i18n/navigation";
import { requireParentMemberships } from "@/lib/parent-auth";
import { ActionForm } from "@/components/action-form";
import { SELECT_CLASS } from "@/components/locale-select";
import type { Locale } from "@/config/i18n";

import { todayInTimeZone } from "@/lib/occurrences";

import {
  bookMakeup,
  enrolChild,
  openParentBillingPortal,
  reportAbsence,
} from "./actions";

import { PortalShell } from "./portal-shell";
import { FamilyPicker } from "./family-picker";

type PortalPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ family?: string }>;
};

/**
 * « Mes enfants » — la première page qu'un parent voit.
 *
 * C'est aussi la première fois depuis la Semaine 7 que les badges atteignent
 * quelqu'un d'autre que le personnel. Le coach coche « flotte 5 s » au bord du
 * bassin ; le parent le voit ici. Toute la chaîne existe enfin.
 *
 * En lecture seule : ce temps ouvre une porte d'accès, il n'ajoute aucune
 * écriture. Mélanger les deux rendrait indécidable l'origine d'un incident.
 */
export default async function PortalPage({
  params,
  searchParams,
}: PortalPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("portal");
  const memberships = await requireParentMemberships(locale);

  /**
   * Aucune famille rattachée : un refus qui dit quoi faire, pas un portail
   * vide. C'est le cas d'un compte dont l'adresse n'est sur aucune fiche —
   * ou dont l'adresse n'est pas encore vérifiée.
   */
  if (memberships.length === 0) {
    return (
      <PortalShell title={t("heading")}>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("noFamilyHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("noFamilyBody")}
          </CardContent>
        </Card>
      </PortalShell>
    );
  }

  /**
   * Une même adresse peut rattacher plusieurs foyers — deux écoles, ou deux
   * familles. On ne choisit pas à sa place : prendre la première serait un
   * choix arbitraire et invisible.
   */
  const requested = (await searchParams).family;
  const active =
    memberships.find((entry) => entry.familyId === requested) ?? memberships[0];

  /**
   * Le jour de l'école, pas celui du serveur : à 20 h à Los Angeles, on est
   * déjà demain à New York. Lu avant le reste, parce que les rattrapages en
   * dépendent — « à venir » n'a de sens que dans un fuseau.
   */
  const schoolTimezone =
    (await getPortalSchool(active.organizationId, active.familyId))?.timezone ??
    "UTC";

  const [school, children, enrollments, classes, billing, makeups, labels] = await Promise.all([
    getPortalSchool(active.organizationId, active.familyId),
    getPortalChildren(active.organizationId, active.familyId),
    getPortalEnrollments(active.organizationId, active.familyId),
    getPortalClasses(active.organizationId, active.familyId),
    getPortalBilling(active.organizationId, active.familyId),
    getPortalMakeups(
      active.organizationId,
      active.familyId,
      todayInTimeZone(schoolTimezone),
    ),
    /**
     * Les libellés des foyers sont lus **sous contexte**, un par un — donc à
     * travers la RLS, qui confirme au passage que chacun est bien accessible.
     * L'amorçage ne fait sortir que des identifiants ; tout ce qui s'affiche
     * repasse par la barrière.
     */
    Promise.all(
      memberships.map(async (entry) => ({
        familyId: entry.familyId,
        label:
          (await getPortalFamilyLabel(entry.organizationId, entry.familyId)) ??
          entry.familyId,
      })),
    ),
  ]);

  return (
    <PortalShell
      title={t("heading")}
      description={school ? t("atSchool", { school: school.name }) : undefined}
    >
      {labels.length > 1 ? (
        <FamilyPicker
          memberships={labels}
          activeFamilyId={active.familyId}
          label={t("chooseFamily")}
        />
      ) : null}

      {children.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("noChildrenHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("noChildrenBody")}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                href={portalStudentPath(child.id)}
                className="bg-card ring-foreground/10 hover:ring-foreground/25 flex items-center justify-between gap-3 rounded-xl p-4 ring-1 transition-colors"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {child.firstName} {child.lastName}
                  </span>
                  <span className="text-muted-foreground mt-0.5 flex items-center gap-2 text-sm">
                    {child.currentLevelColor ? (
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: child.currentLevelColor }}
                      />
                    ) : null}
                    {child.currentLevelName
                      ? `${child.currentProgramName} · ${child.currentLevelName}`
                      : t("noLevel")}
                  </span>
                </span>
                <span aria-hidden className="text-muted-foreground shrink-0">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
        « Mes inscriptions » — les deux états côte à côte.

        `active` et `waitlisted` ne sont pas deux degrés de réussite : le second
        est un résultat normal d'un cours plein, et le dire ainsi évite qu'un
        parent croie que sa demande a échoué.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{t("enrollmentsHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {enrollments.length === 0 ? (
            <p className="text-muted-foreground text-sm text-pretty">
              {t("noEnrollments")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {enrollments.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {entry.levelColor ? (
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.levelColor }}
                      />
                    ) : null}
                    <span className="truncate">
                      <span className="font-medium">
                        {entry.studentFirstName}
                      </span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {entry.klassTitle}
                      </span>
                    </span>
                  </span>

                  <span
                    className={
                      entry.status === "active"
                        ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                        : "rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                    }
                  >
                    {entry.status === "waitlisted" && entry.waitlistRank
                      ? t("waitlistPosition", { rank: entry.waitlistRank })
                      : t(`status_${entry.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {children.length > 0 && classes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("enrolHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActionForm
              action={enrolChild.bind(null, locale as Locale)}
              submitLabel={t("enrol")}
              size="sm"
            >
              <input type="hidden" name="familyId" value={active.familyId} />

              <select
                name="studentId"
                aria-label={t("child")}
                className={SELECT_CLASS}
              >
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.firstName}
                  </option>
                ))}
              </select>

              <select
                name="klassId"
                aria-label={t("klass")}
                className={SELECT_CLASS}
              >
                {classes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} — {t("seatsLeft", {
                      left: Math.max(entry.capacity - entry.taken, 0),
                    })}
                  </option>
                ))}
              </select>
            </ActionForm>

            {/*
              Le nombre affiché informe, le verrou décide. Le dire ici évite
              qu'un parent prenne une place en liste d'attente pour une panne.
            */}
            <p className="text-muted-foreground text-sm text-pretty">
              {t("enrolNote")}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {/*
        Rattrapages.

        Même honnêteté qu'à l'inscription : les places affichées sont
        indicatives, et c'est le verrou pris sur la séance qui décide. Une
        séance qui se remplit entre l'affichage et le tap produit un refus
        expliqué, jamais une erreur technique.
      */}
      {makeups.upcoming.length > 0 || makeups.credits.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("makeupHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {makeups.credits.length > 0 ? (
              <ul className="flex flex-col gap-3 text-sm">
                {makeups.credits.map((credit) => (
                  <li
                    key={credit.creditId}
                    className="ring-foreground/10 rounded-xl p-3 ring-1"
                  >
                    <p className="font-medium">
                      {t("makeupCredit", {
                        child: credit.studentFirstName,
                        date: credit.missedOn,
                      })}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {t(`makeupState_${credit.state}`)}
                      {credit.usableThrough
                        ? ` · ${t("makeupUsableThrough", { date: credit.usableThrough })}`
                        : ""}
                    </p>

                    {credit.state === "available" ? (
                      credit.options.length > 0 ? (
                        <div className="mt-2">
                          <ActionForm
                            action={bookMakeup.bind(null, locale as Locale)}
                            submitLabel={t("makeupBook")}
                            size="sm"
                          >
                            <input type="hidden" name="familyId" value={active.familyId} />
                            <input type="hidden" name="creditId" value={credit.creditId} />
                            <select
                              name="occurrenceId"
                              aria-label={t("makeupSession")}
                              className={SELECT_CLASS}
                            >
                              {credit.options.map((option) => (
                                <option key={option.occurrenceId} value={option.occurrenceId}>
                                  {option.date} · {option.klassTitle} — {t("seatsLeft", { left: option.seatsLeft })}
                                </option>
                              ))}
                            </select>
                          </ActionForm>
                        </div>
                      ) : (
                        <p className="text-muted-foreground mt-2">
                          {t("makeupNoOption")}
                        </p>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {makeups.upcoming.filter((entry) => !entry.alreadyReported).length > 0 ? (
              <ActionForm
                action={reportAbsence.bind(null, locale as Locale)}
                submitLabel={t("reportAbsence")}
                size="sm"
              >
                <input type="hidden" name="familyId" value={active.familyId} />
                <select
                  name="occurrenceId"
                  aria-label={t("makeupSession")}
                  className={SELECT_CLASS}
                >
                  {makeups.upcoming
                    .filter((entry) => !entry.alreadyReported)
                    .map((entry) => (
                      <option
                        key={`${entry.occurrenceId}:${entry.studentId}`}
                        value={entry.occurrenceId}
                      >
                        {entry.date} · {entry.studentFirstName} · {entry.klassTitle}
                      </option>
                    ))}
                </select>
                <input
                  type="hidden"
                  name="studentId"
                  value={makeups.upcoming.find((entry) => !entry.alreadyReported)?.studentId ?? ""}
                />
              </ActionForm>
            ) : null}

            <p className="text-muted-foreground text-sm text-pretty">
              {t("makeupNote")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/*
        Factures — l'écran ne connaît QUE le miroir.

        Il ne peut donc pas annoncer un paiement : seul le webhook signé fait
        passer une facture à `paid`. Ce n'est pas de la discipline, c'est une
        propriété de l'écran — il n'a aucune autre source à consulter.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{t("billingHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!billing.configured ? (
            <p className="text-muted-foreground text-sm text-pretty">
              {t("billingNotConfigured")}
            </p>
          ) : (
            <>
              {billing.outstanding > 0 ? (
                <p className="text-sm">
                  {t("billingOutstanding", {
                    total: new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: (
                        billing.invoices[0]?.currency ?? "usd"
                      ).toUpperCase(),
                    }).format(billing.outstanding / 100),
                  })}
                </p>
              ) : null}

              <ul className="flex flex-col gap-2 text-sm">
                {billing.invoices.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>
                      {new Intl.NumberFormat(locale, {
                        style: "currency",
                        currency: entry.currency.toUpperCase(),
                      }).format(entry.amount / 100)}
                      {entry.dueDate && !entry.paidAt ? (
                        <span className="text-muted-foreground ms-2">
                          {t("dueOn", {
                            date: entry.dueDate.toISOString().slice(0, 10),
                          })}
                        </span>
                      ) : null}
                    </span>

                    <span className="flex items-center gap-3">
                      <span
                        className={
                          entry.paidAt
                            ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                            : "rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                        }
                      >
                        {entry.paidAt ? t("invoicePaid") : t("invoiceOpen")}
                      </span>

                      {/* Le paiement se fait sur la page hébergée par Stripe. */}
                      {!entry.paidAt && entry.hostedInvoiceUrl ? (
                        <a
                          href={entry.hostedInvoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-4"
                        >
                          {t("payInvoice")}
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>

              <ActionForm
                action={openParentBillingPortal.bind(null, locale as Locale)}
                submitLabel={t("managePayment")}
                size="sm"
              >
                <input type="hidden" name="familyId" value={active.familyId} />
              </ActionForm>
            </>
          )}
        </CardContent>
      </Card>
    </PortalShell>
  );
}
