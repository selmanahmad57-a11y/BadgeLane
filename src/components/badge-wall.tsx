import { getTranslations } from "next-intl/server";

import type { StudentLevelProgress } from "@/db/queries";
import { computeLevelBadges, highestEarnedLevel } from "@/lib/badges";
import { cn } from "@/lib/utils";

/**
 * Le mur de badges d'un nageur.
 *
 * C'est la page que le parent verra en Semaine 10, et la raison d'être du nom
 * du produit. Elle doit donner envie de la montrer — d'où le soin porté à la
 * couleur du niveau, à l'état « acquis » et à la coche.
 *
 * Rien n'y est stocké : tout se déduit des compétences acquises. Un niveau dont
 * l'école ajoute une exigence cesse d'être acquis pour ceux qui ne la
 * remplissent pas encore, sans qu'aucun recalcul n'ait à être déclenché.
 */
export async function BadgeWall({
  levels,
}: {
  levels: StudentLevelProgress[];
}) {
  const t = await getTranslations("badges");

  const achieved = new Set(
    levels.flatMap((entry) =>
      entry.entries
        .filter((item) => item.status === "achieved")
        .map((item) => item.skillId),
    ),
  );

  const badges = computeLevelBadges(levels, achieved);
  const highest = highestEarnedLevel(badges);

  /** Un curriculum vide n'a rien à montrer, et le dire vaut mieux qu'un blanc. */
  if (badges.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        {t("noCurriculum")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">
          {t("currentLevelLabel")}
        </span>
        {highest ? (
          <span
            className="rounded-full px-3 py-1 text-sm font-medium text-white"
            style={{ backgroundColor: highest.color }}
          >
            {highest.name}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{t("noneYet")}</span>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {badges.map((badge) => {
          const level = levels.find((entry) => entry.id === badge.levelId);

          return (
            <li
              key={badge.levelId}
              className={cn(
                "rounded-xl p-4 ring-1 transition-colors",
                badge.earned
                  ? "ring-transparent"
                  : "ring-foreground/10 bg-card",
              )}
              /**
               * Le niveau acquis se teinte de sa propre couleur, en fond léger :
               * il se distingue d'un coup d'œil sans écraser la page, et reste
               * lisible quelle que soit la couleur choisie par l'école.
               */
              style={
                badge.earned
                  ? {
                      backgroundColor: `color-mix(in oklch, ${badge.color} 14%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${badge.color} 45%, transparent)`,
                    }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden
                      className="inline-block size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: badge.color }}
                    />
                    <span className="truncate">{badge.name}</span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {t("skillCount", {
                      achieved: badge.achievedSkills,
                      total: badge.totalSkills,
                    })}
                  </p>
                </div>

                {badge.earned ? (
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: badge.color }}
                    aria-label={t("earned")}
                    title={t("earned")}
                  >
                    {/* Coche nette, tracée plutôt qu'empruntée à une police. */}
                    <svg
                      viewBox="0 0 20 20"
                      className="size-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M4 10.5 8 14.5 16 6" />
                    </svg>
                  </span>
                ) : null}
              </div>

              {/* Jauge de progression, dans la couleur du niveau. */}
              <div
                className="bg-foreground/10 mt-3 h-1.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={badge.achievedSkills}
                aria-valuemin={0}
                aria-valuemax={badge.totalSkills}
                aria-label={badge.name}
              >
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${Math.round(badge.ratio * 100)}%`,
                    backgroundColor: badge.color,
                  }}
                />
              </div>

              {level && level.entries.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1">
                  {level.entries.map((item) => (
                    <li
                      key={item.skillId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block size-1.5 shrink-0 rounded-full",
                          item.status === "achieved"
                            ? ""
                            : item.status === "in_progress"
                              ? "bg-foreground/40"
                              : "bg-foreground/15",
                        )}
                        style={
                          item.status === "achieved"
                            ? { backgroundColor: badge.color }
                            : undefined
                        }
                      />
                      <span
                        className={cn(
                          item.status === "achieved"
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.name}
                      </span>
                      {item.status === "in_progress" ? (
                        <span className="text-muted-foreground text-xs">
                          {t("inProgress")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
