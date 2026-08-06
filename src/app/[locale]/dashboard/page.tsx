import { getTranslations, setRequestLocale } from "next-intl/server";

import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganizationSession } from "@/lib/auth";

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

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>{t("emptyHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm text-pretty">
          {t("emptyBody")}
        </CardContent>
      </Card>
    </ConsoleShell>
  );
}
