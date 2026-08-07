import { OrganizationList } from "@clerk/nextjs";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { localizedPath, routes } from "@/config/routes";

type CreateOrganizationPageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Choisir son école, ou en créer une.
 *
 * ── Pourquoi une liste et non un simple formulaire de création ───────────────
 *
 * Jusqu'à la Semaine 10, Clerk imposait une organisation à tout compte
 * connecté (`force_organization_selection`) : personne n'arrivait ici sans
 * école active, et un formulaire de création suffisait.
 *
 * Ce forçage est incompatible avec le portail parent — un parent n'appartient
 * délibérément à aucune organisation, et Clerk lui demanderait de fonder une
 * école de natation. En le retirant, c'est à l'application de gérer les deux
 * cas : le membre du personnel qui doit **sélectionner** son école, et le
 * fondateur qui doit en **créer** une.
 *
 * `OrganizationList` fait les deux. Sans elle, un membre existant arrivant ici
 * n'aurait d'autre choix que de créer une seconde école — un dégât silencieux,
 * puisque rien n'aurait échoué.
 *
 * L'Organization est créée côté Clerk ; la ligne correspondante en base est
 * écrite à la première ouverture du dashboard, par `syncOrganizationMembership()`.
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

      {/*
        `hidePersonal` : BadgeLane n'a pas de notion d'espace personnel — on
        travaille toujours au nom d'une école.
      */}
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl={localizedPath(locale, routes.dashboard)}
        afterCreateOrganizationUrl={localizedPath(locale, routes.dashboard)}
      />
    </main>
  );
}
