import { CreateOrganization } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { localizedPath, routes } from "@/config/routes";

type CreateOrganizationPageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Création d'une école. L'Organization est créée côté Clerk ; la ligne
 * correspondante en base est écrite à la première ouverture du dashboard, par
 * `syncOrganizationMembership()`.
 */
export default async function CreateOrganizationPage({
  params,
}: CreateOrganizationPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("organization");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="font-heading text-2xl font-semibold">
          {t("createHeading")}
        </h1>
        <p className="text-muted-foreground text-sm">{t("createBody")}</p>
      </div>

      <CreateOrganization
        routing="path"
        path={localizedPath(locale, routes.createOrganization)}
        afterCreateOrganizationUrl={localizedPath(locale, routes.dashboard)}
      />
    </main>
  );
}
