import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isStripeConfigured } from "@/config/env.stripe";
import { can } from "@/config/permissions";
import { requireOrganizationSession } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { SELECT_CLASS } from "@/components/locale-select";
import { Input } from "@/components/ui/input";
import {
  AT_RISK_SUBSCRIPTION_STATUSES,
  isRecurringInterval,
  TERM_INVOICE_DAYS_UNTIL_DUE,
  TUITION_INTERVALS,
  UNPAID_INVOICE_STATUSES,
} from "@/config/billing";
import { FIELD_LIMITS } from "@/config/validation";
import { getBillingOverview } from "@/db/queries";

import {
  createCheckoutLink,
  createTuitionPlan,
  issueTermInvoice,
  openCustomerPortal,
  startStripeOnboarding,
} from "./actions";

type BillingPageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Réglages → Facturation : état du compte Stripe de l'école.
 *
 * L'état affiché est lu **chez Stripe**, pas dans notre base. Nous ne stockons
 * que l'identifiant du compte : savoir si les encaissements sont autorisés est
 * une décision de Stripe, qui peut changer sans nous prévenir — une pièce
 * d'identité à fournir, une vérification en cours. Recopier cet état
 * l'afficherait périmé.
 */
export default async function BillingPage({ params }: BillingPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("billing");

  const canManage = can(session.staffUser.role, "billing:manage");
  const accountId = session.organization.stripeAccountId;

  /** Lecture directe : l'état d'un compte connecté ne se met pas en cache. */
  const stripe = getStripe();
  const account =
    stripe && accountId
      ? await stripe.v2.core.accounts
          .retrieve(accountId, {
            include: ["configuration.merchant", "requirements"],
          })
          .catch(() => null)
      : null;

  /**
   * En v2, « peut encaisser » se lit dans les capacités de la configuration
   * marchande, et non dans un booléen `charges_enabled`. Une capacité absente
   * n'est pas active : l'onboarding n'est pas terminé.
   */
  const capabilities = account?.configuration?.merchant?.capabilities;
  const ready = capabilities?.card_payments?.status === "active";
  const started = Boolean(accountId);

  /** Tarifs, abonnements et factures ne s'affichent qu'une fois le compte prêt. */
  const overview = ready
    ? await getBillingOverview(session.organization.id)
    : null;

  /**
   * Les montants sont formatés dans la langue du visiteur et la devise de
   * l'école — jamais concaténés à la main : une virgule décimale, un espace
   * insécable et la place du symbole changent d'une langue à l'autre.
   */
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: session.organization.currency,
  });

  /**
   * Les deux familles de tarifs, séparées une fois pour toutes : l'abonnement
   * et la facture ponctuelle n'ouvrent pas le même formulaire.
   */
  const recurringPlans =
    overview?.plans.filter((plan) => isRecurringInterval(plan.interval)) ?? [];
  const oneOffPlans =
    overview?.plans.filter((plan) => !isRecurringInterval(plan.interval)) ?? [];

  /** Seules les familles ayant un dossier chez Stripe ont un portail. */
  const billedFamilies = overview?.families.filter((entry) => entry.billed) ?? [];

  /**
   * Ce qui reste à récupérer.
   *
   * Stripe relance tout seul — nouvelles tentatives sur les abonnements,
   * rappels sur les factures, au nom de l'école. Le rôle de cet écran n'est
   * donc pas de relancer, mais de **montrer** : sans cette liste, l'école
   * apprendrait ses impayés en consultant le tableau de bord Stripe.
   */
  const unpaidInvoices =
    overview?.invoices.filter((entry) =>
      UNPAID_INVOICE_STATUSES.includes(entry.status),
    ) ?? [];
  const atRiskSubscriptions =
    overview?.subscriptions.filter((entry) =>
      AT_RISK_SUBSCRIPTION_STATUSES.includes(entry.status),
    ) ?? [];
  const unpaidTotal = unpaidInvoices.reduce(
    (total, entry) => total + entry.amount,
    0,
  );

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {!isStripeConfigured ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("notConfiguredHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("notConfiguredBody")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {ready
                ? t("readyHeading")
                : started
                  ? t("incompleteHeading")
                  : t("notStartedHeading")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm text-pretty">
              {ready
                ? t("readyBody")
                : started
                  ? t("incompleteBody")
                  : t("notStartedBody")}
            </p>

            {accountId ? (
              <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <dt className="text-muted-foreground">{t("accountLabel")}</dt>
                <dd className="font-mono text-xs">{accountId}</dd>
                <dt className="text-muted-foreground">{t("chargesLabel")}</dt>
                <dd>{ready ? t("chargesEnabled") : t("chargesDisabled")}</dd>
              </dl>
            ) : null}

            {canManage && !ready ? (
              <ActionForm
                action={startStripeOnboarding}
                submitLabel={started ? t("resume") : t("connect")}
              />
            ) : null}

            <p className="text-muted-foreground text-sm text-pretty">
              {t("merchantNote")}
            </p>
          </CardContent>
        </Card>
      )}

      {overview ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("plansHeading")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {overview.plans.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noPlans")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {overview.plans.map((plan) => (
                    <li
                      key={plan.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span className="font-medium">{plan.name}</span>
                      <span className="text-muted-foreground">
                        {money.format(plan.amount / 100)} ·{" "}
                        {t(`interval_${plan.interval}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {canManage ? (
                <ActionForm action={createTuitionPlan} submitLabel={t("addPlan")} size="sm">
                  <Input
                    name="name"
                    required
                    maxLength={FIELD_LIMITS.name}
                    placeholder={t("planNamePlaceholder")}
                    aria-label={t("planName")}
                    className="w-full sm:w-56"
                  />
                  <Input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder={t("amountPlaceholder")}
                    aria-label={t("amount")}
                    className="w-full sm:w-32"
                  />
                  <select
                    name="interval"
                    aria-label={t("interval")}
                    className={SELECT_CLASS}
                  >
                    {TUITION_INTERVALS.map((value) => (
                      <option key={value} value={value}>
                        {t(`interval_${value}`)}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              ) : null}
            </CardContent>
          </Card>

          {/*
            À récupérer, en tête d'écran.

            Stripe fait les relances — c'est lui qui écrit aux familles, au nom
            de l'école. Ce bloc ne relance rien : il évite à l'école d'aller
            chercher ses impayés dans le tableau de bord Stripe.
          */}
          {unpaidInvoices.length > 0 || atRiskSubscriptions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("outstandingHeading")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {unpaidInvoices.length > 0 ? (
                  <>
                    <p className="text-sm">
                      {t("outstandingSummary", {
                        count: unpaidInvoices.length,
                        total: money.format(unpaidTotal / 100),
                      })}
                    </p>
                    <ul className="flex flex-col gap-2 text-sm">
                      {unpaidInvoices.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span>
                            {entry.familyName}
                            {entry.dueDate ? (
                              <span className="text-muted-foreground ms-2">
                                {t("dueOn", {
                                  date: entry.dueDate.toISOString().slice(0, 10),
                                })}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-3">
                            <span>
                              {new Intl.NumberFormat(locale, {
                                style: "currency",
                                currency: entry.currency.toUpperCase(),
                              }).format(entry.amount / 100)}
                            </span>
                            {entry.hostedInvoiceUrl ? (
                              <a
                                href={entry.hostedInvoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline underline-offset-4"
                              >
                                {t("paymentLink")}
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {atRiskSubscriptions.length > 0 ? (
                  <ul className="flex flex-col gap-2 text-sm">
                    {atRiskSubscriptions.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>{entry.familyName}</span>
                        <span className="text-muted-foreground">
                          {entry.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <p className="text-muted-foreground text-sm text-pretty">
                  {t("dunningNote")}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {canManage && billedFamilies.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("portalHeading")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ActionForm action={openCustomerPortal} submitLabel={t("openPortal")} size="sm">
                  <select name="familyId" aria-label={t("family")} className={SELECT_CLASS}>
                    {billedFamilies.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </ActionForm>
                <p className="text-muted-foreground text-sm text-pretty">
                  {t("portalNote")}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/*
            Deux formulaires plutôt qu'un seul avec une liste mêlée : abonner une
            famille et lui émettre une facture au trimestre ne produisent pas le
            même objet chez Stripe. Ne proposer que les tarifs valides pour
            chaque geste évite d'avoir à refuser après coup — l'action refuse
            quand même, car rien n'empêche de soumettre l'autre à la main.
          */}
          {canManage && recurringPlans.length > 0 && overview.families.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("subscribeHeading")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ActionForm action={createCheckoutLink} submitLabel={t("openCheckout")} size="sm">
                  <select name="familyId" aria-label={t("family")} className={SELECT_CLASS}>
                    {overview.families.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <select name="planId" aria-label={t("plan")} className={SELECT_CLASS}>
                    {recurringPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} — {money.format(plan.amount / 100)}
                      </option>
                    ))}
                  </select>
                </ActionForm>
                <p className="text-muted-foreground text-sm text-pretty">
                  {t("checkoutNote")}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {canManage && oneOffPlans.length > 0 && overview.families.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("issueInvoiceHeading")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ActionForm action={issueTermInvoice} submitLabel={t("issueInvoice")} size="sm">
                  <select name="familyId" aria-label={t("family")} className={SELECT_CLASS}>
                    {overview.families.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <select name="planId" aria-label={t("plan")} className={SELECT_CLASS}>
                    {oneOffPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} — {money.format(plan.amount / 100)}
                      </option>
                    ))}
                  </select>
                </ActionForm>
                <p className="text-muted-foreground text-sm text-pretty">
                  {t("issueInvoiceNote", { days: TERM_INVOICE_DAYS_UNTIL_DUE })}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("subscriptionsHeading")}</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.subscriptions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("noSubscriptions")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {overview.subscriptions.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {entry.familyName}
                        {entry.planName ? (
                          <span className="text-muted-foreground ms-2">
                            {entry.planName}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground">
                        {entry.status}
                        {entry.currentPeriodEnd
                          ? ` · ${entry.currentPeriodEnd.toISOString().slice(0, 10)}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("invoicesHeading")}</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.invoices.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("noInvoices")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {overview.invoices.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {entry.familyName}
                        {entry.dueDate && !entry.paidAt ? (
                          <span className="text-muted-foreground ms-2">
                            {t("dueOn", {
                              date: entry.dueDate.toISOString().slice(0, 10),
                            })}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-3">
                        <span>
                          {new Intl.NumberFormat(locale, {
                            style: "currency",
                            currency: entry.currency.toUpperCase(),
                          }).format(entry.amount / 100)}{" "}
                          · {entry.status}
                        </span>
                        {/*
                          Le lien de paiement est celui que Stripe a émis, pas
                          une adresse reconstruite : c'est lui qu'on enverra au
                          parent quand les relances arriveront.
                        */}
                        {entry.hostedInvoiceUrl && !entry.paidAt ? (
                          <a
                            href={entry.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-foreground underline underline-offset-4"
                          >
                            {t("paymentLink")}
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground mt-3 text-sm text-pretty">
                {t("mirrorNote")}
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </ConsoleShell>
  );
}
