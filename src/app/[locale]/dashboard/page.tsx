import { ClerkLoaded, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

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
    <main className="flex flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold">
            {t("heading")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("welcome", { name: session.fullName ?? session.email })}
          </p>
        </div>

        {/*
          Ces deux composants Clerk lisent la session côté navigateur. Montés
          avant que le SDK client ait fini de se charger, ils avertissent
          qu'aucune session n'est active — alors que la page, elle, est bien
          rendue côté serveur pour un utilisateur authentifié.

          `ClerkLoaded` diffère leur rendu jusqu'à ce que la session cliente
          soit disponible. La réserve d'espace évite que l'en-tête ne sursaute
          au moment où ils apparaissent.
        */}
        <div className="flex min-h-8 items-center gap-3">
          <ClerkLoaded>
            <OrganizationSwitcher hidePersonal />
            <UserButton />
          </ClerkLoaded>
        </div>
      </header>

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
    </main>
  );
}
