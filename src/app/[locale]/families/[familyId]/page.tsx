import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { LocaleSelect } from "@/components/locale-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { languageName } from "@/config/i18n";
import { can } from "@/config/permissions";
import { studentPath } from "@/config/routes";
import { FIELD_LIMITS } from "@/config/validation";
import { getFamilyDetail } from "@/db/queries";
import { Link } from "@/i18n/navigation";
import { requireOrganizationSession } from "@/lib/auth";

import {
  createGuardian,
  createStudent,
  deleteFamily,
  deleteGuardian,
  deleteStudent,
  updateFamily,
  updateGuardian,
} from "../actions";

type FamilyPageProps = {
  params: Promise<{ locale: string; familyId: string }>;
};

export default async function FamilyPage({ params }: FamilyPageProps) {
  const { locale, familyId } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("families");

  const family = await getFamilyDetail(session.organization.id, familyId);

  /**
   * `getFamilyDetail` filtre par école : une famille appartenant à une autre
   * organisation est indiscernable d'une famille inexistante. C'est voulu — un
   * 404 ne révèle rien, là où un 403 confirmerait l'existence de la ligne.
   */
  if (!family) notFound();

  const canWrite = can(session.staffUser.role, "family:write");

  return (
    <ConsoleShell
      title={family.primaryGuardianName}
      description={family.email}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("contactHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          {canWrite ? (
            <ActionForm action={updateFamily} submitLabel={t("save")} size="sm">
              <input type="hidden" name="familyId" value={family.id} />
              <Input
                name="primaryGuardianName"
                required
                defaultValue={family.primaryGuardianName}
                maxLength={FIELD_LIMITS.name}
                aria-label={t("primaryGuardianName")}
                className="w-full sm:w-56"
              />
              <Input
                type="email"
                name="email"
                required
                defaultValue={family.email}
                maxLength={FIELD_LIMITS.email}
                aria-label={t("email")}
                className="w-full sm:w-64"
              />
              <Input
                type="tel"
                name="phone"
                defaultValue={family.phone ?? ""}
                maxLength={FIELD_LIMITS.phone}
                placeholder={t("phonePlaceholder")}
                aria-label={t("phone")}
                className="w-full sm:w-44"
              />
              <LocaleSelect
                name="preferredLanguage"
                label={t("preferredLanguage")}
                defaultValue={family.preferredLanguage}
              />
            </ActionForm>
          ) : (
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">{t("phone")}</dt>
              <dd>{family.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">{t("preferredLanguage")}</dt>
              <dd lang={family.preferredLanguage}>
                {languageName(family.preferredLanguage)}
              </dd>
            </dl>
          )}

          {canWrite ? (
            <ActionForm
              action={deleteFamily}
              submitLabel={t("deleteFamily")}
              variant="destructive"
              size="sm"
            >
              <input type="hidden" name="familyId" value={family.id} />
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>

      {canWrite ? (
        <p className="text-muted-foreground -mt-4 text-sm text-pretty">
          {t("deleteWarning")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("guardiansHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {family.guardians.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noGuardians")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {family.guardians.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-end justify-between gap-3"
                >
                  {canWrite ? (
                    <ActionForm
                      action={updateGuardian}
                      submitLabel={t("save")}
                      size="sm"
                    >
                      <input
                        type="hidden"
                        name="guardianId"
                        value={entry.id}
                      />
                      <input type="hidden" name="familyId" value={family.id} />
                      <Input
                        name="name"
                        required
                        defaultValue={entry.name}
                        maxLength={FIELD_LIMITS.name}
                        aria-label={t("guardianName")}
                        className="w-full sm:w-48"
                      />
                      <Input
                        type="email"
                        name="email"
                        defaultValue={entry.email ?? ""}
                        maxLength={FIELD_LIMITS.email}
                        placeholder={t("emailPlaceholder")}
                        aria-label={t("email")}
                        className="w-full sm:w-56"
                      />
                      <Input
                        type="tel"
                        name="phone"
                        defaultValue={entry.phone ?? ""}
                        maxLength={FIELD_LIMITS.phone}
                        placeholder={t("phonePlaceholder")}
                        aria-label={t("phone")}
                        className="w-full sm:w-40"
                      />
                      <LocaleSelect
                        name="preferredLanguage"
                        label={t("preferredLanguage")}
                        defaultValue={entry.preferredLanguage}
                      />
                    </ActionForm>
                  ) : (
                    <div className="text-sm">
                      <p className="font-medium">{entry.name}</p>
                      <p className="text-muted-foreground">
                        {[entry.email, entry.phone].filter(Boolean).join(" · ") ||
                          "—"}
                      </p>
                    </div>
                  )}

                  {canWrite ? (
                    <ActionForm
                      action={deleteGuardian}
                      submitLabel={t("delete")}
                      variant="ghost"
                      size="sm"
                    >
                      <input
                        type="hidden"
                        name="guardianId"
                        value={entry.id}
                      />
                      <input type="hidden" name="familyId" value={family.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <ActionForm
              action={createGuardian}
              submitLabel={t("addGuardian")}
              size="sm"
            >
              <input type="hidden" name="familyId" value={family.id} />
              <Input
                name="name"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("guardianNamePlaceholder")}
                aria-label={t("guardianName")}
                className="w-full sm:w-48"
              />
              <Input
                type="email"
                name="email"
                maxLength={FIELD_LIMITS.email}
                placeholder={t("emailPlaceholder")}
                aria-label={t("email")}
                className="w-full sm:w-56"
              />
              <Input
                type="tel"
                name="phone"
                maxLength={FIELD_LIMITS.phone}
                placeholder={t("phonePlaceholder")}
                aria-label={t("phone")}
                className="w-full sm:w-40"
              />
              <LocaleSelect
                name="preferredLanguage"
                label={t("preferredLanguage")}
              />
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("studentsHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {family.students.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noStudents")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {family.students.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <Link
                    href={studentPath(family.id, entry.id)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {entry.firstName} {entry.lastName}
                  </Link>

                  {canWrite ? (
                    <ActionForm
                      action={deleteStudent}
                      submitLabel={t("delete")}
                      variant="ghost"
                      size="xs"
                    >
                      <input type="hidden" name="studentId" value={entry.id} />
                      <input type="hidden" name="familyId" value={family.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <ActionForm
              action={createStudent}
              submitLabel={t("addStudent")}
              size="sm"
            >
              <input type="hidden" name="familyId" value={family.id} />
              <Input
                name="firstName"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("firstNamePlaceholder")}
                aria-label={t("firstName")}
                className="w-full sm:w-40"
              />
              <Input
                name="lastName"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("lastNamePlaceholder")}
                aria-label={t("lastName")}
                className="w-full sm:w-40"
              />
              <Input
                type="date"
                name="dateOfBirth"
                required
                aria-label={t("dateOfBirth")}
                className="w-full sm:w-44"
              />
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>
    </ConsoleShell>
  );
}
