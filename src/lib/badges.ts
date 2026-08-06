/**
 * Calcul des badges de progression — le cœur du produit.
 *
 * ── Pourquoi un badge ne se stocke pas ───────────────────────────────────────
 *
 * Un niveau est acquis quand **toutes** ses compétences le sont. C'est une
 * propriété de l'état courant, pas un événement à enregistrer.
 *
 * La conséquence est contre-intuitive et pourtant juste : **ajouter une
 * compétence à un niveau retire le badge aux élèves qui ne l'ont pas encore
 * acquise**. C'est correct — le niveau exige désormais davantage, et ils ne le
 * remplissent plus. Un badge stocké resterait affiché à tort jusqu'à ce qu'un
 * recalcul, écrit un jour et oublié le lendemain, vienne le corriger.
 *
 * Logique pure, sans base de données : donc entièrement vérifiable, comme la
 * génération des séances de la Semaine 4.
 */

export type SkillRef = { id: string; name: string };

export type LevelWithSkills = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  skills: SkillRef[];
};

export type LevelBadge = {
  levelId: string;
  name: string;
  color: string;
  sortOrder: number;
  totalSkills: number;
  achievedSkills: number;
  /** Toutes les compétences acquises — et il y en a au moins une. */
  earned: boolean;
  /** Part acquise, de 0 à 1. Vaut 0 pour un niveau sans compétence. */
  ratio: number;
};

/**
 * État des badges d'un élève, niveau par niveau.
 *
 * `achievedSkillIds` ne contient que les compétences réellement acquises :
 * `in_progress` a une valeur pédagogique — « travaille le dos » — mais ne
 * complète pas un niveau.
 */
export function computeLevelBadges(
  levels: readonly LevelWithSkills[],
  achievedSkillIds: ReadonlySet<string>,
): LevelBadge[] {
  return [...levels]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((level) => {
      const totalSkills = level.skills.length;
      const achievedSkills = level.skills.filter((entry) =>
        achievedSkillIds.has(entry.id),
      ).length;

      return {
        levelId: level.id,
        name: level.name,
        color: level.color,
        sortOrder: level.sortOrder,
        totalSkills,
        achievedSkills,
        /**
         * Un niveau vide n'est pas acquis. Sans cette condition, un niveau
         * qu'on vient de créer et dont les compétences ne sont pas encore
         * saisies apparaîtrait comme validé par tout le monde — l'inverse de
         * ce que la couleur promet.
         */
        earned: totalSkills > 0 && achievedSkills === totalSkills,
        ratio: totalSkills === 0 ? 0 : achievedSkills / totalSkills,
      };
    });
}

/**
 * Niveau le plus avancé effectivement acquis, ou `null`.
 *
 * Sert de repère principal sur la fiche de l'enfant : « où en est-il ? ».
 * Le tri par `sortOrder` est celui de la progression pédagogique définie par
 * l'école, pas un ordre alphabétique.
 */
export function highestEarnedLevel(badges: readonly LevelBadge[]): LevelBadge | null {
  return (
    [...badges]
      .filter((badge) => badge.earned)
      .sort((a, b) => b.sortOrder - a.sortOrder)[0] ?? null
  );
}
