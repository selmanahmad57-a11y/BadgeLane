import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import { FIELD_LIMITS } from "@/config/validation";
import { getTerms } from "@/db/queries";
import { requireOrganizationSession } from "@/lib/auth";

import { createTerm, deleteTerm, updateTerm } from "../schedule/actions";

type TermsPageProps = {
  params: Promise<{ locale: string }>;
};

/** Sessions d'enseignement : trimestres, saisons, stages d'été. */
export default async function TermsPage({ params }: TermsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("terms");

  const terms = await getTerms(session.organization.id);
  const canWrite = can(session.staffUser.role, "schedule:write");

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("newTerm")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createTerm} submitLabel={t("add")}>
              <Input
                name="name"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("namePlaceholder")}
                aria-label={t("name")}
                className="w-full sm:w-56"
              />
              <Input
                type="date"
                name="startDate"
                required
                aria-label={t("startDate")}
                className="w-full sm:w-44"
              />
              <Input
                type="date"
                name="endDate"
                required
                aria-label={t("endDate")}
                className="w-full sm:w-44"
              />
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="enrollmentOpen"
                  value="true"
                  className="size-4"
                />
                {t("enrollmentOpen")}
              </label>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {terms.length === 0 ? (
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
          {terms.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardContent className="flex flex-wrap items-end justify-between gap-4">
                  {canWrite ? (
                    <ActionForm
                      action={updateTerm}
                      submitLabel={t("save")}
                      size="sm"
                    >
                      <input type="hidden" name="termId" value={entry.id} />
                      <Input
                        name="name"
                        required
                        defaultValue={entry.name}
                        maxLength={FIELD_LIMITS.name}
                        aria-label={t("name")}
                        className="w-full sm:w-48"
                      />
                      <Input
                        type="date"
                        name="startDate"
                        required
                        defaultValue={entry.startDate}
                        aria-label={t("startDate")}
                        className="w-full sm:w-40"
                      />
                      <Input
                        type="date"
                        name="endDate"
                        required
                        defaultValue={entry.endDate}
                        aria-label={t("endDate")}
                        className="w-full sm:w-40"
                      />
                      <label className="text-muted-foreground flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="enrollmentOpen"
                          value="true"
                          defaultChecked={entry.enrollmentOpen}
                          className="size-4"
                        />
                        {t("enrollmentOpen")}
                      </label>
                    </ActionForm>
                  ) : (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">{entry.name}</p>
                      <p className="text-muted-foreground">
                        {entry.startDate} → {entry.endDate}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-sm">
                      {t("classCount", { count: entry.klassCount })}
                    </span>

                    {canWrite ? (
                      <ActionForm
                        action={deleteTerm}
                        submitLabel={t("delete")}
                        variant="destructive"
                        size="sm"
                      >
                        <input type="hidden" name="termId" value={entry.id} />
                      </ActionForm>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canWrite && terms.length > 0 ? (
        <p className="text-muted-foreground -mt-4 text-sm text-pretty">
          {t("deleteWarning")}
        </p>
      ) : null}
    </ConsoleShell>
  );
}
