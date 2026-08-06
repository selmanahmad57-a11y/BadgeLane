import {
  computeLevelBadges,
  highestEarnedLevel,
  type LevelWithSkills,
} from "../src/lib/badges";

/**
 * Éprouve le calcul des badges.
 *
 * Cette logique est juste mais contre-intuitive — ajouter une exigence retire
 * un badge — et c'est exactement le genre de règle qu'on « corrige » un jour
 * par erreur, en croyant réparer un bug. Le test dit ce qui est voulu.
 *
 * Comme la génération des séances, c'est de la logique pure : aucune base, donc
 * entièrement vérifiable.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  console.log(
    condition ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) failures.push(label);
}

const guppy: LevelWithSkills = {
  id: "guppy",
  name: "Guppy",
  color: "#0ea5e9",
  sortOrder: 10,
  skills: [
    { id: "s1", name: "Entre dans l'eau" },
    { id: "s2", name: "Souffle des bulles" },
  ],
};

const minnow: LevelWithSkills = {
  id: "minnow",
  name: "Minnow",
  color: "#22c55e",
  sortOrder: 20,
  skills: [{ id: "s3", name: "Flotte sur le dos" }],
};

console.log("\nBadge de niveau");

const nothing = computeLevelBadges([guppy, minnow], new Set());
check("aucune compétence acquise : aucun badge", nothing.every((b) => !b.earned));
check("la part acquise vaut zéro", nothing.every((b) => b.ratio === 0));

const partial = computeLevelBadges([guppy, minnow], new Set(["s1"]));
check(
  "une compétence sur deux ne donne pas le badge",
  !partial[0].earned && partial[0].achievedSkills === 1,
);
check("la part acquise vaut la moitié", partial[0].ratio === 0.5);

const complete = computeLevelBadges([guppy, minnow], new Set(["s1", "s2"]));
check("toutes les compétences acquises donnent le badge", complete[0].earned);
check("le niveau suivant reste non acquis", !complete[1].earned);

console.log("\nLe cas qui compte : le curriculum évolue");

/**
 * Une école ajoute une exigence à Guppy. Les élèves qui avaient le badge ne
 * remplissent plus le niveau : ils ne l'ont plus. C'est voulu.
 */
const guppyExtended: LevelWithSkills = {
  ...guppy,
  skills: [...guppy.skills, { id: "s9", name: "Met la tête sous l'eau" }],
};

const before = computeLevelBadges([guppy], new Set(["s1", "s2"]));
const after = computeLevelBadges([guppyExtended], new Set(["s1", "s2"]));

check("le badge était acquis avant l'ajout", before[0].earned);
check(
  "ajouter une compétence retire le badge à qui ne l'a pas acquise",
  !after[0].earned,
  "un badge stocké resterait affiché à tort",
);
check(
  "et le compte reflète la nouvelle exigence",
  after[0].achievedSkills === 2 && after[0].totalSkills === 3,
);

const stillEarned = computeLevelBadges(
  [guppyExtended],
  new Set(["s1", "s2", "s9"]),
);
check(
  "celui qui acquiert la nouvelle compétence retrouve le badge",
  stillEarned[0].earned,
);

console.log("\nCas limites");

const empty = computeLevelBadges(
  [{ id: "vide", name: "Vide", color: "#000", sortOrder: 5, skills: [] }],
  new Set(),
);
check(
  "un niveau sans compétence n'est jamais acquis",
  !empty[0].earned,
  "sinon un niveau tout juste créé apparaîtrait validé par tout le monde",
);

const unrelated = computeLevelBadges([guppy], new Set(["s3", "inconnue"]));
check(
  "des compétences d'un autre niveau ne comptent pas",
  !unrelated[0].earned && unrelated[0].achievedSkills === 0,
);

console.log("\nNiveau le plus avancé");

check(
  "aucun badge : aucun niveau atteint",
  highestEarnedLevel(nothing) === null,
);
check(
  "deux niveaux acquis : le plus avancé selon l'ordre pédagogique",
  highestEarnedLevel(
    computeLevelBadges([guppy, minnow], new Set(["s1", "s2", "s3"])),
  )?.levelId === "minnow",
);
check(
  "l'ordre est celui du curriculum, pas l'alphabétique",
  highestEarnedLevel(
    computeLevelBadges(
      [
        { ...guppy, name: "Zebra", sortOrder: 10 },
        { ...minnow, name: "Alpha", sortOrder: 20 },
      ],
      new Set(["s1", "s2", "s3"]),
    ),
  )?.name === "Alpha",
);

console.log(
  failures.length === 0
    ? "\nBadges : OK.\n"
    : `\nBadges : ÉCHEC — ${failures.length} contrôle(s).\n`,
);

process.exitCode = failures.length === 0 ? 0 : 1;
