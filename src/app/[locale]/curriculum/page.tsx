import { getTranslations, setRequestLocale } from "next-intl/server";

import { ActionForm } from "@/components/action-form";
import { ConsoleShell } from "@/components/console-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { can } from "@/config/permissions";
import {
  DEFAULT_LEVEL_COLOR,
  FIELD_LIMITS,
  LEVEL_COLOR_SUGGESTIONS,
} from "@/config/validation";
import { getCurriculum, type CurriculumProgram } from "@/db/queries";
import { requireOrganizationSession } from "@/lib/auth";

import {
  createLevel,
  createProgram,
  createSkill,
  deleteLevel,
  deleteProgram,
  deleteSkill,
} from "./actions";

type CurriculumPageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Curriculum : programmes -> niveaux -> compétences (§4-A du blueprint).
 *
 * C'est la structure qui portera le suivi de progression par badges en
 * Semaine 7 : chaque compétence listée ici deviendra une case que le coach
 * cochera au bord du bassin.
 */
export default async function CurriculumPage({ params }: CurriculumPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireOrganizationSession(locale);
  const t = await getTranslations("curriculum");

  const programs = await getCurriculum(session.organization.id);

  /**
   * Le coach consulte le curriculum sans le modifier. Masquer les formulaires
   * n'est qu'un confort : la protection réelle est dans les actions serveur,
   * qui refusent l'écriture quel que soit ce qu'affiche la page.
   */
  const canWrite = can(session.staffUser.role, "curriculum:write");

  return (
    <ConsoleShell title={t("heading")} description={t("intro")}>
      <LevelColorSuggestions />

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("newProgram")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createProgram} submitLabel={t("addProgram")}>
              <Input
                name="name"
                required
                maxLength={FIELD_LIMITS.name}
                placeholder={t("programNamePlaceholder")}
                aria-label={t("programName")}
                className="w-full sm:w-64"
              />
              <Input
                name="description"
                maxLength={FIELD_LIMITS.description}
                placeholder={t("programDescriptionPlaceholder")}
                aria-label={t("programDescription")}
                className="w-full sm:w-80"
              />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {programs.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("emptyHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm text-pretty">
            {canWrite ? t("emptyBody") : t("emptyBodyReadOnly")}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {programs.map((entry) => (
            <ProgramCard key={entry.id} program={entry} canWrite={canWrite} />
          ))}
        </div>
      )}
    </ConsoleShell>
  );
}

async function ProgramCard({
  program,
  canWrite,
}: {
  program: CurriculumProgram;
  canWrite: boolean;
}) {
  const t = await getTranslations("curriculum");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{program.name}</CardTitle>
            {program.description ? (
              <p className="text-muted-foreground text-sm">
                {program.description}
              </p>
            ) : null}
          </div>

          {canWrite ? (
            <ActionForm
              action={deleteProgram}
              submitLabel={t("delete")}
              variant="destructive"
              size="sm"
            >
              <input type="hidden" name="programId" value={program.id} />
            </ActionForm>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {program.levels.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noLevels")}</p>
        ) : (
          program.levels.map((entry) => (
            <section
              key={entry.id}
              className="border-border border-s-2 ps-4"
              /**
               * Bordure logique (`border-s`) et non « à gauche » : en arabe ou
               * en hébreu, elle passera automatiquement du bon côté.
               */
              style={{ borderInlineStartColor: entry.color }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{entry.name}</h3>

                {canWrite ? (
                  <ActionForm
                    action={deleteLevel}
                    submitLabel={t("delete")}
                    variant="ghost"
                    size="xs"
                  >
                    <input type="hidden" name="levelId" value={entry.id} />
                  </ActionForm>
                ) : null}
              </div>

              <ul className="mt-2 flex flex-col gap-1">
                {entry.skills.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>{item.name}</span>

                    {canWrite ? (
                      <ActionForm
                        action={deleteSkill}
                        submitLabel={t("delete")}
                        variant="ghost"
                        size="xs"
                      >
                        <input type="hidden" name="skillId" value={item.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>

              {canWrite ? (
                <ActionForm
                  action={createSkill}
                  submitLabel={t("addSkill")}
                  size="sm"
                  className="mt-3"
                >
                  <input type="hidden" name="levelId" value={entry.id} />
                  <Input
                    name="name"
                    required
                    maxLength={FIELD_LIMITS.name}
                    placeholder={t("skillNamePlaceholder")}
                    aria-label={t("skillName")}
                    className="w-full sm:w-72"
                  />
                </ActionForm>
              ) : null}
            </section>
          ))
        )}

        {canWrite ? (
          <ActionForm action={createLevel} submitLabel={t("addLevel")} size="sm">
            <input type="hidden" name="programId" value={program.id} />
            <Input
              name="name"
              required
              maxLength={FIELD_LIMITS.name}
              placeholder={t("levelNamePlaceholder")}
              aria-label={t("levelName")}
              className="w-full sm:w-56"
            />
            {/*
              Un `input[type=color]` natif : accessible au clavier, traduit par
              le système, et il renvoie toujours un hexadécimal à six chiffres —
              exactement ce que la validation serveur attend.
            */}
            <Input
              type="color"
              name="color"
              defaultValue={DEFAULT_LEVEL_COLOR}
              aria-label={t("levelColor")}
              list="level-color-suggestions"
              className="h-9 w-14 p-1"
            />
          </ActionForm>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Palette proposée au sélecteur de couleur.
 *
 * Rendue une seule fois pour toute la page : un `datalist` est référencé par
 * identifiant, il n'a pas à être dupliqué à chaque champ.
 */
function LevelColorSuggestions() {
  return (
    <datalist id="level-color-suggestions">
      {LEVEL_COLOR_SUGGESTIONS.map((color) => (
        <option key={color} value={color} />
      ))}
    </datalist>
  );
}
