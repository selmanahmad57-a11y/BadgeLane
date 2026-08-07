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
  /** Gérer les sessions, les cours et leurs séances. */
  "schedule:write",
  /** Relever la présence au bord du bassin. */
  "attendance:write",
  /** Valider les compétences acquises. */
  "progression:write",
  /** Connecter le compte Stripe de l'école et gérer les tarifs. */
  "billing:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * La matrice des droits. Toute modification ici doit être répercutée dans
 * `scripts/authz-verify.ts`, qui affirme la matrice attendue explicitement :
 * élargir un rôle sans le vouloir devient alors impossible en silence.
 */
const CAPABILITIES_BY_ROLE: Readonly<Record<StaffRole, readonly Capability[]>> =
  {
    owner: [
      "curriculum:write",
      "location:write",
      "staff:manage",
      "family:write",
      "schedule:write",
      "attendance:write",
      "progression:write",
      "billing:manage",
    ],
    admin: [
      "curriculum:write",
      "location:write",
      "staff:manage",
      "family:write",
      "schedule:write",
      "attendance:write",
      "progression:write",
      "billing:manage",
    ],
    /**
     * Le coach écrit deux choses, et deux seulement : la présence et les
     * compétences acquises. Ce sont ses gestes — ceux que personne ne peut
     * faire à sa place, accomplis au bord du bassin, sans accès à un bureau.
     *
     * Tout le reste lui reste en lecture — il a besoin de savoir qui il
     * encadre et de lire les notes médicales, pas de tenir les fiches. Cette
     * unique ouverture est vérifiée par `npm run authz:verify` : la porte doit
     * s'ouvrir d'un cran, pas en grand.
     */
    coach: ["attendance:write", "progression:write"],
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
