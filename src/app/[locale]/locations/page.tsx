import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import { FIELD_LIMITS } from "@/config/validation";
import { getLocations } from "@/db/queries";
import { requireOrganizationSession } from "@/lib/auth";

import { createLocation, deleteLocation, updateLocation } from "./actions";

type LocationsPageProps = {
  params: Promise<{ locale: string }>;
};

/** Lieux où se déroulent les cours : bassins, sites (§3 du blueprint). */
export default async function LocationsPage({ params }: LocationsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("locations");

  const locations = await getLocations(session.organization.id);
  const canWrite = can(session.staffUser.role, "location:write");

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("newLocation")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createLocation} submitLabel={t("add")}>
              <Input
                name="name"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("namePlaceholder")}
                aria-label={t("name")}
                className="w-full sm:w-64"
              />
              <Input
                name="address"
                maxLength={FIELD_LIMITS.address}
                placeholder={t("addressPlaceholder")}
                aria-label={t("address")}
                className="w-full sm:w-80"
              />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {locations.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("emptyHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {canWrite ? t("emptyBody") : t("emptyBodyReadOnly")}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {locations.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  {canWrite ? (
                    /**
                     * Modification en place : les champs sont pré-remplis et le
                     * même formulaire sert à lire et à corriger. Un écran
                     * d'édition séparé serait disproportionné pour deux champs.
                     */
                    <ActionForm action={updateLocation} submitLabel={t("save")} size="sm">
                      <input
                        type="hidden"
                        name="locationId"
                        value={entry.id}
                      />
                      <Input
                        name="name"
                        required
                        defaultValue={entry.name}
                        maxLength={FIELD_LIMITS.name}
                        aria-label={t("name")}
                        className="w-full sm:w-56"
                      />
                      <Input
                        name="address"
                        defaultValue={entry.address ?? ""}
                        maxLength={FIELD_LIMITS.address}
                        placeholder={t("addressPlaceholder")}
                        aria-label={t("address")}
                        className="w-full sm:w-72"
                      />
                    </ActionForm>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-medium">{entry.name}</p>
                      {entry.address ? (
                        <p className="text-muted-foreground text-sm">
                          {entry.address}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {canWrite ? (
                    <ActionForm
                      action={deleteLocation}
                      submitLabel={t("delete")}
                      variant="destructive"
                      size="sm"
                    >
                      <input
                        type="hidden"
                        name="locationId"
                        value={entry.id}
                      />
                    </ActionForm>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </ConsoleShell>
  );
}
