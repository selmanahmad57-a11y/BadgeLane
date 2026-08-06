import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { BadgeWall } from "@/components/badge-wall";
import { ConsoleShell } from "@/components/console-shell";
import { SELECT_CLASS } from "@/components/locale-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import { familyPath } from "@/config/routes";
import { FIELD_LIMITS } from "@/config/validation";
import {
  getLevelOptions,
  getStudentDetail,
  getStudentProgress,
} from "@/db/queries";
import { Link } from "@/i18n/navigation";
import { requireOrganizationSession } from "@/lib/auth";

import { updateStudent } from "../../../actions";

type StudentPageProps = {
  params: Promise<{ locale: string; familyId: string; studentId: string }>;
};

export default async function StudentPage({ params }: StudentPageProps) {
  const { locale, familyId, studentId } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("students");

  const [student, levelOptions, progress] = await Promise.all([
    getStudentDetail(session.organization.id, studentId),
    getLevelOptions(session.organization.id),
    getStudentProgress(session.organization.id, studentId),
  ]);

  /**
   * Un élève d'une autre école est indiscernable d'un élève inexistant : la
   * requête filtre par organisation, et l'absence produit un 404. Répondre
   * « interdit » confirmerait l'existence de la fiche.
   */
  if (!student || student.familyId !== familyId) notFound();

  const canWrite = can(session.staffUser.role, "family:write");
  const currentLevel = levelOptions.find(
    (option) => option.id === student.currentLevelId,
  );

  return (
    <ConsoleShell
      title={`${student.firstName} ${student.lastName}`}
      description={t("belongsTo", { family: student.family.primaryGuardianName })}
    >
      <p className="-mt-4 text-sm">
        <Link
          href={familyPath(familyId)}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("backToFamily")}
        </Link>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{t("detailsHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {canWrite ? (
            <ActionForm action={updateStudent} submitLabel={t("save")}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="familyId" value={familyId} />

              <Input
                name="firstName"
                required
                defaultValue={student.firstName}
                maxLength={FIELD_LIMITS.name}
                aria-label={t("firstName")}
                className="w-full sm:w-40"
              />
              <Input
                name="lastName"
                required
                defaultValue={student.lastName}
                maxLength={FIELD_LIMITS.name}
                aria-label={t("lastName")}
                className="w-full sm:w-40"
              />
              <Input
                type="date"
                name="dateOfBirth"
                required
                defaultValue={student.dateOfBirth}
                aria-label={t("dateOfBirth")}
                className="w-full sm:w-44"
              />

              {/*
                Les options ne listent que les niveaux de cette école. Rien
                n'empêche pourtant d'en soumettre un autre en modifiant la page :
                l'action serveur vérifie l'appartenance du niveau avant
                d'enregistrer, car la contrainte de clé étrangère, elle,
                accepterait celui d'une école concurrente.
              */}
              <select
                name="currentLevelId"
                aria-label={t("currentLevel")}
                defaultValue={student.currentLevelId ?? ""}
                className={SELECT_CLASS}
              >
                <option value="">{t("noLevel")}</option>
                {levelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.programName} · {option.name}
                  </option>
                ))}
              </select>

              <Input
                name="medicalNotes"
                defaultValue={student.medicalNotes ?? ""}
                maxLength={FIELD_LIMITS.medicalNotes}
                placeholder={t("medicalNotesPlaceholder")}
                aria-label={t("medicalNotes")}
                className="w-full sm:w-96"
              />
            </ActionForm>
          ) : (
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">{t("dateOfBirth")}</dt>
              <dd>{student.dateOfBirth}</dd>
              <dt className="text-muted-foreground">{t("currentLevel")}</dt>
              <dd>
                {currentLevel
                  ? `${currentLevel.programName} · ${currentLevel.name}`
                  : t("noLevel")}
              </dd>
              <dt className="text-muted-foreground">{t("medicalNotes")}</dt>
              <dd className="text-pretty">{student.medicalNotes ?? "—"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <p className="text-muted-foreground -mt-4 text-sm text-pretty">
          {t("medicalNotesHint")}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("badgesHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <BadgeWall levels={progress} />
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>{t("historyHeading")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm text-pretty">
          {t("historyBody")}
        </CardContent>
      </Card>
    </ConsoleShell>
  );
}
