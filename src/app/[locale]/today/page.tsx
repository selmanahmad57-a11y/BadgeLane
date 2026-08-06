import { getTranslations, setRequestLocale } from "next-intl/server";

import { AttendanceSheet } from "@/components/attendance-sheet";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { can } from "@/config/permissions";
import { DATE_PATTERN } from "@/config/scheduling";
import { getPoolsideSkills, getSessionsForDate } from "@/db/queries";
import { requireOrganizationSession } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/occurrences";

import { submitAttendance } from "./actions";
import { submitProgress } from "./progress-actions";

type TodayPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string }>;
};

/**
 * L'écran du bord du bassin (§4-B du blueprint).
 *
 * Toutes les séances du jour de l'école, pas seulement celles du coach
 * connecté : beaucoup de cours n'ont pas encore d'instructeur assigné, et un
 * remplacement de dernière minute ne doit jamais empêcher de faire l'appel.
 * L'auteur du relevé reste tracé par `marked_by`.
 */
export default async function TodayPage({
  params,
  searchParams,
}: TodayPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("today");

  /**
   * La date par défaut est celle de l'école, jamais celle du serveur : à 20 h
   * à Los Angeles, on est déjà demain à New York.
   */
  const requested = (await searchParams).date;
  const date =
    requested && DATE_PATTERN.test(requested)
      ? requested
      : todayInTimeZone(session.organization.timezone);

  const sessions = await getSessionsForDate(session.organization.id, date);

  /** Compétences du niveau courant de chaque élève présent au planning du jour. */
  const studentIds = [
    ...new Set(
      sessions.flatMap((entry) => entry.roster.map((row) => row.studentId)),
    ),
  ];
  const skillsByStudent = await getPoolsideSkills(
    session.organization.id,
    studentIds,
  );

  const canWrite = can(session.staffUser.role, "attendance:write");
  const canMarkProgress = can(session.staffUser.role, "progression:write");

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {/*
        Le choix de date accepte n'importe quel jour : sans cela, un coach qui
        oublie l'appel le mardi ne pourrait plus le rattraper le mercredi.
      */}
      <form className="flex flex-wrap items-end gap-2">
        <Input
          type="date"
          name="date"
          defaultValue={date}
          aria-label={t("date")}
          className="w-full sm:w-44"
        />
        <Button type="submit" variant="outline">
          {t("showDate")}
        </Button>
      </form>

      {sessions.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("noSessionsHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("noSessionsBody", { date })}
          </CardContent>
        </Card>
      ) : (
        <AttendanceSheet
          sessions={sessions}
          poolsideSkills={Object.fromEntries(skillsByStudent)}
          staffUserId={session.staffUser.id}
          canWrite={canWrite}
          canMarkProgress={canMarkProgress}
          submit={submitAttendance}
          submitProgress={submitProgress}
        />
      )}
    </ConsoleShell>
  );
}
