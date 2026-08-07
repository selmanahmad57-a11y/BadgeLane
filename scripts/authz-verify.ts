import {
  CAPABILITIES,
  ForbiddenError,
  assertCan,
  can,
  type Capability,
} from "../src/config/permissions";
import { STAFF_ROLES, type StaffRole } from "../src/config/roles";

/**
 * Affirme la matrice des droits, rôle par rôle et capacité par capacité.
 *
 * ── Pourquoi ce test existe ──────────────────────────────────────────────────
 *
 * En Semaine 6, la capacité d'écriture s'ouvre au coach pour la première fois.
 * Une ouverture est le moment où l'on élargit trop : une ligne ajoutée au
 * mauvais tableau, et le coach peut supprimer un programme.
 *
 * Ce fichier répète donc la matrice attendue **à la main**. C'est délibérément
 * redondant avec la configuration : c'est cette redondance qui fait le test.
 * Toute modification de `CAPABILITIES_BY_ROLE` non répercutée ici échoue —
 * autrement dit, élargir un droit devient un acte conscient.
 *
 * C'est le pendant, côté autorisation, du contrôle négatif utilisé partout
 * ailleurs : sans lui, rien ne prouve que la porte ne s'est pas ouverte
 * en grand.
 */

const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (!condition) {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

/** Matrice attendue, écrite en toutes lettres. */
const EXPECTED: Record<StaffRole, Record<Capability, boolean>> = {
  owner: {
    "curriculum:write": true,
    "location:write": true,
    "staff:manage": true,
    "family:write": true,
    "schedule:write": true,
    "attendance:write": true,
    "progression:write": true,
    "billing:manage": true,
  },
  admin: {
    "curriculum:write": true,
    "location:write": true,
    "staff:manage": true,
    "family:write": true,
    "schedule:write": true,
    "attendance:write": true,
    "progression:write": true,
    "billing:manage": true,
  },
  /**
   * Deux crans, et deux seulement : la présence (Semaine 6) et les compétences
   * (Semaine 7). Ce sont les deux gestes du bord du bassin.
   */
  coach: {
    "curriculum:write": false,
    "location:write": false,
    "staff:manage": false,
    "family:write": false,
    "schedule:write": false,
    "attendance:write": true,
    "progression:write": true,
    /** L'argent de l'école ne regarde pas le coach. */
    "billing:manage": false,
  },
};

console.log("\nMatrice des droits");

/**
 * Une capacité ajoutée à la configuration sans l'être ici doit faire échouer :
 * sinon un nouveau droit serait introduit sans que personne ne se prononce.
 */
for (const capability of CAPABILITIES) {
  for (const role of STAFF_ROLES) {
    check(
      `${role} / ${capability} déclaré dans la matrice attendue`,
      capability in EXPECTED[role],
      "capacité absente de scripts/authz-verify.ts",
    );
  }
}

for (const role of STAFF_ROLES) {
  for (const capability of CAPABILITIES) {
    const expected = EXPECTED[role][capability];
    const actual = can(role, capability);

    check(
      `${role} ${expected ? "peut" : "ne peut pas"} ${capability}`,
      actual === expected,
      `obtenu : ${actual ? "autorisé" : "refusé"}`,
    );

    /** `assertCan` est la garde réellement appelée par les actions serveur. */
    let threw = false;
    try {
      assertCan(role, capability);
    } catch (error) {
      threw = error instanceof ForbiddenError;
    }

    check(
      `${role} / ${capability} : assertCan concorde avec can`,
      threw === !expected,
    );
  }
}

const coachWritable = CAPABILITIES.filter((capability) =>
  can("coach", capability),
);

console.log(`\n  Le coach écrit : ${coachWritable.join(", ") || "rien"}`);

/**
 * Affirmé en toutes lettres : le coach écrit la présence et les compétences,
 * rien d'autre. Une capacité supplémentaire qui lui serait accordée par
 * inadvertance échouerait ici, même si quelqu'un pensait à mettre à jour la
 * matrice ci-dessus.
 */
check(
  "le coach ne détient que les deux capacités du bord du bassin",
  coachWritable.length === 2 &&
    coachWritable.includes("attendance:write") &&
    coachWritable.includes("progression:write"),
  coachWritable.join(", "),
);

console.log(
  failures.length === 0
    ? "\nAutorisations : OK.\n"
    : `\nAutorisations : ÉCHEC — ${failures.length} contrôle(s).\n`,
);

process.exitCode = failures.length === 0 ? 0 : 1;
