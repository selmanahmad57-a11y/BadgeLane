import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  LIVE_ENROLLMENT_STATUSES,
  SEAT_TAKING_STATUSES,
} from "@/config/enrollment";

import { enrollment, klass } from "./schema";
import type { TenantTransaction } from "./tenant";
import { CrossTenantReferenceError } from "./tenant-guard";

/**
 * Opérations d'inscription — chemin d'écriture unique.
 *
 * ── Le problème que ce module résout ─────────────────────────────────────────
 *
 * Capacité 8, sept inscrits. Deux administrateurs valident au même instant.
 * Les deux lisent « 7 », les deux concluent qu'il reste une place, les deux
 * insèrent. Neuf enfants dans un bassin qui en accepte huit.
 *
 * Aucune contrainte Postgres ne l'empêche : un `CHECK` ne sait pas compter les
 * lignes d'une autre table, et un index unique ne porte que sur des colonnes.
 * La seule parade est de **verrouiller la ligne du cours** avant de compter,
 * ce qui sérialise les inscriptions d'un même cours — et d'un seul : les autres
 * cours continuent en parallèle.
 *
 * Toute opération touchant à l'occupation d'un cours passe donc par ici.
 * `npm run enrollment:verify` en fait la preuve en lançant deux inscriptions
 * réellement simultanées sur la dernière place.
 */

/**
 * Ordre de la file d'attente. **Définition unique** — toute requête qui classe
 * la file lit cette clé.
 *
 * Le jour où une école voudra remonter une fratrie, il suffira d'insérer une
 * colonne de priorité **en tête** de ce tableau : aucune requête ne changera.
 */
export const WAITLIST_ORDER = [
  asc(enrollment.waitlistedAt),
  /** Départage déterministe quand deux inscriptions partagent l'horodatage. */
  asc(enrollment.id),
] as const;

/** Expression SQL du rang, dérivée de la même clé. */
export const WAITLIST_RANK = sql<number>`row_number() over (
  partition by ${enrollment.klassId}
  order by ${enrollment.waitlistedAt} asc, ${enrollment.id} asc
)`;

export type SeatState = { capacity: number; taken: number; hasSeat: boolean };

/**
 * Verrouille le cours et compte les places occupées.
 *
 * `for('update')` bloque toute autre transaction voulant le même cours jusqu'à
 * la fin de celle-ci. C'est ce qui rend le décompte fiable : entre le comptage
 * et l'insertion, personne d'autre ne peut s'intercaler.
 *
 * Le verrou porte sur la ligne du cours et non sur la table : deux inscriptions
 * dans deux cours différents ne s'attendent pas.
 */
export async function lockKlassAndCountSeats(
  tx: TenantTransaction,
  organizationId: string,
  klassId: string,
): Promise<SeatState> {
  const [target] = await tx
    .select({ capacity: klass.capacity })
    .from(klass)
    .where(
      and(eq(klass.id, klassId), eq(klass.organizationId, organizationId)),
    )
    .limit(1)
    .for("update");

  /**
   * Absent signifie « pas dans cette école » : la lecture est soumise à la RLS.
   * Les contraintes de clé étrangère, elles, accepteraient le cours d'une école
   * concurrente — d'où ce contrôle, comme partout ailleurs.
   */
  if (!target) {
    throw new CrossTenantReferenceError("klass", klassId);
  }

  /**
   * Le décompte passe par `count_seats_taken`, jamais par une lecture directe
   * d'`enrollment`.
   *
   * ── Pourquoi, et ce que ça évite ────────────────────────────────────────────
   *
   * Depuis la Semaine 10, `enrollment` est restreinte aux enfants du foyer
   * courant. Une lecture directe compterait donc, pour un parent, les places
   * occupées **de sa propre famille** — zéro, presque toujours. Tout cours
   * paraîtrait vide, et chaque parent entrerait dans un bassin complet. Sans
   * erreur, sans log : la barrière ferait son travail, et ce serait le
   * problème.
   *
   * La fonction s'exécute en `security definer`, donc hors RLS, mais **dans
   * cette transaction** : même instantané, verrou tenu. Faire ce compte depuis
   * une seconde connexion pour échapper à la RLS relirait hors du verrou et
   * rouvrirait la course en silence.
   *
   * Les statuts sont passés en argument plutôt qu'écrits dans le SQL : le
   * vocabulaire métier n'a qu'une définition, `SEAT_TAKING_STATUSES`.
   */
  const [occupied] = (
    await tx.execute(
      sql`select count_seats_taken(${klassId}::uuid, ${sql.param([
        ...SEAT_TAKING_STATUSES,
      ])}::text[]) as total`,
    )
  ).rows as unknown as { total: number }[];

  const taken = Number(occupied?.total ?? 0);

  return {
    capacity: target.capacity,
    taken,
    hasSeat: taken < target.capacity,
  };
}

/** Une inscription vivante existe-t-elle déjà pour ce couple élève/cours ? */
export async function hasLiveEnrollment(
  tx: TenantTransaction,
  organizationId: string,
  klassId: string,
  studentId: string,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: enrollment.id })
    .from(enrollment)
    .where(
      and(
        eq(enrollment.organizationId, organizationId),
        eq(enrollment.klassId, klassId),
        eq(enrollment.studentId, studentId),
        inArray(enrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
      ),
    )
    .limit(1);

  return Boolean(existing);
}
