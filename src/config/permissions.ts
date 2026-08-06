import type { StaffRole } from "./roles";

/**
 * Qui a le droit de faire quoi, par rôle.
 *
 * Table unique et déclarative : les contrôles d'autorisation ne comparent
 * jamais un rôle en dur au fil du code. Ajouter une capacité, ou changer les
 * rôles qui la détiennent, se fait ici et nulle part ailleurs.
 *
 * ⚠️ Ces vérifications sont faites **côté serveur** (§7 du blueprint). Masquer
 * un bouton dans l'interface n'est pas une protection : c'est du confort. La
 * garde qui compte est celle des actions serveur.
 */
export const CAPABILITIES = [
  /** Créer, modifier, supprimer programmes, niveaux et compétences. */
  "curriculum:write",
  /** Créer, modifier, supprimer les lieux. */
  "location:write",
  /** Inviter du personnel et changer les rôles. */
  "staff:manage",
  /** Créer, modifier, supprimer familles, tuteurs et élèves. */
  "family:write",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Le coach n'apparaît dans aucune liste : il consulte le curriculum et les
 * lieux depuis l'application coach, mais ne les modifie pas. C'est la
 * répartition décrite au §4 du blueprint.
 */
const CAPABILITIES_BY_ROLE: Readonly<Record<StaffRole, readonly Capability[]>> =
  {
    owner: [
      "curriculum:write",
      "location:write",
      "staff:manage",
      "family:write",
    ],
    admin: [
      "curriculum:write",
      "location:write",
      "staff:manage",
      "family:write",
    ],
    /**
     * Le coach consulte familles et élèves depuis le bord du bassin — il a
     * besoin de savoir qui il encadre, et de lire les notes médicales. Il ne
     * les modifie pas : la fiche d'un enfant est tenue par l'administration.
     */
    coach: [],
  };

export function can(role: StaffRole, capability: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}

/**
 * Erreur levée quand une action serveur est appelée sans le droit requis.
 * Distinguée d'une erreur technique : elle se traduit par un refus, pas par
 * une panne.
 */
export class ForbiddenError extends Error {
  constructor(
    readonly role: StaffRole,
    readonly capability: Capability,
  ) {
    super(
      `Le rôle « ${role} » ne dispose pas de la capacité « ${capability} ».`,
    );
    this.name = "ForbiddenError";
  }
}

/** Lève si le rôle n'a pas la capacité. À appeler au début de chaque écriture. */
export function assertCan(role: StaffRole, capability: Capability): void {
  if (!can(role, capability)) {
    throw new ForbiddenError(role, capability);
  }
}
