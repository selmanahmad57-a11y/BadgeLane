import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { LocaleSelect } from "@/components/locale-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import { familyPath } from "@/config/routes";
import { FIELD_LIMITS } from "@/config/validation";
import { searchFamilies } from "@/db/queries";
import { Link } from "@/i18n/navigation";
import { requireOrganizationSession } from "@/lib/auth";

import { createFamily } from "./actions";

type FamiliesPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
};

/** Nom du paramètre de recherche, présent dans l'URL pour rester partageable. */
const SEARCH_PARAM = "q";

export default async function FamiliesPage({
  params,
  searchParams,
}: FamiliesPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("families");

  const query = (await searchParams)[SEARCH_PARAM] ?? "";
  const families = await searchFamilies(session.organization.id, query);

  const canWrite = can(session.staffUser.role, "family:write");

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {/*
        Recherche par formulaire GET : le terme atterrit dans l'URL, ce qui rend
        le résultat partageable, rechargeable et navigable avec le bouton retour
        — sans une ligne de JavaScript.
      */}
      <form className="flex flex-wrap items-end gap-2">
        <Input
          type="search"
          name={SEARCH_PARAM}
          defaultValue={query}
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
          className="w-full sm:w-80"
        />
        <Button type="submit" variant="outline">
          {t("search")}
        </Button>
      </form>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("newFamily")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createFamily} submitLabel={t("add")}>
              <Input
                name="primaryGuardianName"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("primaryGuardianNamePlaceholder")}
                aria-label={t("primaryGuardianName")}
                className="w-full sm:w-56"
              />
              <Input
                type="email"
                name="email"
                required
                maxLength={FIELD_LIMITS.email}
                placeholder={t("emailPlaceholder")}
                aria-label={t("email")}
                className="w-full sm:w-64"
              />
              <Input
                type="tel"
                name="phone"
                maxLength={FIELD_LIMITS.phone}
                placeholder={t("phonePlaceholder")}
                aria-label={t("phone")}
                className="w-full sm:w-44"
              />
              <LocaleSelect
                name="preferredLanguage"
                label={t("preferredLanguage")}
              />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {families.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>
              {query ? t("noMatchHeading") : t("emptyHeading")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {query
              ? t("noMatchBody", { query })
              : canWrite
                ? t("emptyBody")
                : t("emptyBodyReadOnly")}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {families.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <Link
                      href={familyPath(entry.id)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {entry.primaryGuardianName}
                    </Link>
                    <p className="text-muted-foreground truncate text-sm">
                      {entry.email}
                      {entry.phone ? ` · ${entry.phone}` : ""}
                    </p>
                  </div>

                  <p className="text-muted-foreground text-sm">
                    {t("counts", {
                      guardians: entry.guardianCount,
                      students: entry.studentCount,
                    })}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </ConsoleShell>
  );
}
