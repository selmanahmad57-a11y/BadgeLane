import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { SELECT_CLASS } from "@/components/locale-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import { routes } from "@/config/routes";
import {
  CLASS_CAPACITY,
  CLASS_DURATION_MINUTES,
  orderedDaysOfWeek,
} from "@/config/scheduling";
import { FIELD_LIMITS } from "@/config/validation";
import {
  getClassEnrolment,
  getEnrollableStudents,
  getInstructorOptions,
  getLevelOptions,
  getLocationOptions,
  getOccurrences,
  getScheduledClasses,
  getTerms,
} from "@/db/queries";
import { Link } from "@/i18n/navigation";
import { requireOrganizationSession } from "@/lib/auth";

import {
  createClass,
  deleteClass,
  regenerateOccurrences,
  setOccurrenceStatus,
} from "./actions";
import {
  endEnrollment,
  enrollStudent,
  promoteEnrollment,
} from "./enrollment-actions";

type SchedulePageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ term?: string; klass?: string }>;
};

/**
 * Grille hebdomadaire des cours (§4-A du blueprint).
 *
 * Session et cours sélectionnés vivent dans l'URL : la vue reste partageable
 * — « regarde le mardi de la session d'automne » devient un lien.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: SchedulePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("schedule");
  const dayNames = await getTranslations("days");

  const query = await searchParams;
  const organizationId = session.organization.id;

  const terms = await getTerms(organizationId);
  /** À défaut de sélection, la session la plus récente. */
  const activeTerm =
    terms.find((entry) => entry.id === query.term) ?? terms[0] ?? null;

  const canWrite = can(session.staffUser.role, "schedule:write");

  if (!activeTerm) {
    return (
      <ConsoleShell title={t("heading")} description={t("intro")}>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("noTermHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {t("noTermBody")}{" "}
            <Link
              href={routes.terms}
              className="text-foreground underline underline-offset-4"
            >
              {t("goToTerms")}
            </Link>
          </CardContent>
        </Card>
      </ConsoleShell>
    );
  }

  const [classes, levelOptions, locationOptions, instructorOptions] =
    await Promise.all([
      getScheduledClasses(organizationId, activeTerm.id),
      getLevelOptions(organizationId),
      getLocationOptions(organizationId),
      getInstructorOptions(organizationId),
    ]);

  const selectedClass =
    classes.find((entry) => entry.id === query.klass) ?? null;

  const [occurrences, enrolment, enrollableStudents] = selectedClass
    ? await Promise.all([
        getOccurrences(organizationId, selectedClass.id),
        getClassEnrolment(organizationId, selectedClass.id),
        getEnrollableStudents(organizationId, selectedClass.id),
      ])
    : [[], null, []];

  /**
   * L'ordre des colonnes suit la langue : la semaine commence dimanche aux
   * États-Unis, lundi en Espagne. Donnée CLDR, pas liste écrite à la main.
   */
  const days = orderedDaysOfWeek(locale);

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      {/* Sélection de session par formulaire GET : la vue reste partageable. */}
      <form className="flex flex-wrap items-end gap-2">
        <select
          name="term"
          aria-label={t("term")}
          defaultValue={activeTerm.id}
          className={SELECT_CLASS}
        >
          {terms.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} · {entry.startDate} → {entry.endDate}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm underline underline-offset-4"
        >
          {t("showTerm")}
        </button>
      </form>

      <div className="grid gap-3 lg:grid-cols-7">
        {days.map((day) => {
          const dayClasses = classes.filter(
            (entry) => entry.dayOfWeek === day,
          );

          return (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {dayNames(String(day))}
              </h2>

              {dayClasses.length === 0 ? (
                <p className="text-muted-foreground/60 text-sm">—</p>
              ) : (
                dayClasses.map((entry) => (
                  <Card key={entry.id} className="text-sm">
                    <CardContent
                      className="border-s-2 ps-3"
                      style={{ borderInlineStartColor: entry.levelColor }}
                    >
                      <Link
                        href={`${routes.schedule}?term=${activeTerm.id}&klass=${entry.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {entry.title}
                      </Link>
                      <p className="text-muted-foreground mt-1">
                        {entry.startTime.slice(0, 5)} ·{" "}
                        {t("durationMinutes", { minutes: entry.durationMin })}
                      </p>
                      <p className="text-muted-foreground truncate">
                        {entry.levelName} · {entry.locationName}
                      </p>
                      <p className="text-muted-foreground truncate">
                        {entry.instructorName ?? t("noInstructor")}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        {t("capacityLabel", { capacity: entry.capacity })} ·{" "}
                        {t("occurrenceCount", { count: entry.occurrenceCount })}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </section>
          );
        })}
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("newClass")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {levelOptions.length === 0 || locationOptions.length === 0 ? (
              <p className="text-muted-foreground text-sm text-pretty">
                {t("missingPrerequisites")}
              </p>
            ) : (
              <ActionForm action={createClass} submitLabel={t("addClass")}>
                <input type="hidden" name="termId" value={activeTerm.id} />
                <Input
                  name="title"
                  required
                  maxLength={FIELD_LIMITS.name}
                  placeholder={t("titlePlaceholder")}
                  aria-label={t("title")}
                  className="w-full sm:w-48"
                />

                {/*
                  Seul le niveau est demandé : le programme s'en déduit côté
                  serveur. Faire saisir les deux imposerait de les tenir
                  cohérents, et une donnée dérivable ne se saisit pas.
                */}
                <select
                  name="levelId"
                  aria-label={t("level")}
                  className={SELECT_CLASS}
                  required
                >
                  {levelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.programName} · {option.name}
                    </option>
                  ))}
                </select>
                <select
                  name="locationId"
                  aria-label={t("location")}
                  className={SELECT_CLASS}
                  required
                >
                  {locationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>

                <select
                  name="instructorId"
                  aria-label={t("instructor")}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("noInstructor")}</option>
                  {instructorOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  name="dayOfWeek"
                  aria-label={t("day")}
                  className={SELECT_CLASS}
                  required
                >
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {dayNames(String(day))}
                    </option>
                  ))}
                </select>

                <Input
                  type="time"
                  name="startTime"
                  required
                  aria-label={t("startTime")}
                  className="w-full sm:w-32"
                />
                <Input
                  type="number"
                  name="durationMin"
                  required
                  min={CLASS_DURATION_MINUTES.minimum}
                  max={CLASS_DURATION_MINUTES.maximum}
                  placeholder={t("duration")}
                  aria-label={t("duration")}
                  className="w-full sm:w-28"
                />
                <Input
                  type="number"
                  name="capacity"
                  required
                  min={CLASS_CAPACITY.minimum}
                  max={CLASS_CAPACITY.maximum}
                  placeholder={t("capacity")}
                  aria-label={t("capacity")}
                  className="w-full sm:w-28"
                />
              </ActionForm>
            )}

            <p className="text-muted-foreground text-sm text-pretty">
              {t("timezoneNote", { timezone: session.organization.timezone })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {selectedClass && enrolment ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("rosterHeading", {
                title: selectedClass.title,
                taken: enrolment.roster.length,
                capacity: enrolment.capacity,
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {enrolment.roster.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noRoster")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {enrolment.roster.map((entry) => (
                  <li
                    key={entry.enrollmentId}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {entry.studentName}
                      {entry.startDate ? (
                        <span className="text-muted-foreground ms-2">
                          {t("since", { date: entry.startDate })}
                        </span>
                      ) : null}
                    </span>

                    {canWrite ? (
                      <ActionForm
                        action={endEnrollment}
                        submitLabel={t("endEnrollment")}
                        size="xs"
                        variant="ghost"
                      >
                        <input
                          type="hidden"
                          name="enrollmentId"
                          value={entry.enrollmentId}
                        />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {enrolment.waitlist.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {t("waitlistHeading", { count: enrolment.waitlist.length })}
                </h3>
                <ul className="flex flex-col gap-2">
                  {enrolment.waitlist.map((entry) => (
                    <li
                      key={entry.enrollmentId}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>
                        <span className="text-muted-foreground me-2">
                          #{entry.rank}
                        </span>
                        {entry.studentName}
                      </span>

                      {canWrite ? (
                        <div className="flex items-center gap-1">
                          <ActionForm
                            action={promoteEnrollment}
                            submitLabel={t("promote")}
                            size="xs"
                            variant="outline"
                          >
                            <input
                              type="hidden"
                              name="enrollmentId"
                              value={entry.enrollmentId}
                            />
                          </ActionForm>
                          <ActionForm
                            action={endEnrollment}
                            submitLabel={t("remove")}
                            size="xs"
                            variant="ghost"
                          >
                            <input
                              type="hidden"
                              name="enrollmentId"
                              value={entry.enrollmentId}
                            />
                          </ActionForm>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-sm text-pretty">
                  {t("waitlistNote")}
                </p>
              </div>
            ) : null}

            {canWrite && enrollableStudents.length > 0 ? (
              <ActionForm
                action={enrollStudent}
                submitLabel={t("enroll")}
                size="sm"
              >
                <input
                  type="hidden"
                  name="klassId"
                  value={selectedClass.id}
                />
                <select
                  name="studentId"
                  aria-label={t("student")}
                  className={SELECT_CLASS}
                  required
                >
                  {enrollableStudents.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </ActionForm>
            ) : null}

            {canWrite ? (
              <p className="text-muted-foreground text-sm text-pretty">
                {t("enrollNote")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {selectedClass ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("occurrencesHeading", { title: selectedClass.title })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canWrite ? (
              <div className="flex flex-wrap items-center gap-3">
                <ActionForm
                  action={regenerateOccurrences}
                  submitLabel={t("regenerate")}
                  size="sm"
                  variant="outline"
                >
                  <input
                    type="hidden"
                    name="klassId"
                    value={selectedClass.id}
                  />
                </ActionForm>

                <ActionForm
                  action={deleteClass}
                  submitLabel={t("deleteClass")}
                  size="sm"
                  variant="destructive"
                >
                  <input
                    type="hidden"
                    name="klassId"
                    value={selectedClass.id}
                  />
                </ActionForm>
              </div>
            ) : null}

            <p className="text-muted-foreground text-sm text-pretty">
              {t("regenerateNote")}
            </p>

            {occurrences.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("noOccurrences")}
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {occurrences.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span
                      className={
                        entry.status === "cancelled"
                          ? "text-muted-foreground line-through"
                          : ""
                      }
                    >
                      {entry.date}
                    </span>

                    {canWrite ? (
                      <ActionForm
                        action={setOccurrenceStatus}
                        submitLabel={
                          entry.status === "cancelled"
                            ? t("restore")
                            : t("cancel")
                        }
                        size="xs"
                        variant="ghost"
                      >
                        <input
                          type="hidden"
                          name="occurrenceId"
                          value={entry.id}
                        />
                        <input
                          type="hidden"
                          name="status"
                          value={
                            entry.status === "cancelled"
                              ? "scheduled"
                              : "cancelled"
                          }
                        />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </ConsoleShell>
  );
}
