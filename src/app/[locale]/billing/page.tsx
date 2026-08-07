import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isStripeConfigured } from "@/config/env.stripe";
import { can } from "@/config/permissions";
import { requireOrganizationSession } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

import { startStripeOnboarding } from "./actions";

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
    </ConsoleShell>
  );
}
