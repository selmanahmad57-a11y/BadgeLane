import type { MakeupDerivedState } from "@/config/makeup";
import { CANCELLED_OCCURRENCE_STATUS } from "@/config/scheduling";

/**
 * L'état **lu** d'un crédit de rattrapage.
 *
 * ── Pourquoi ce module est pur et sans `server-only` ────────────────────────
 *
 * Quatre états visibles, deux stockés. Toute la différence est ici — donc
 * cette fonction est la définition de « ce crédit est-il utilisable ? ». Une
 * règle de ce poids doit pouvoir être **exécutée par un script**, sinon elle
 * n'est vérifiable que par relecture. Même raison que `verified-email.ts` et
 * `stripe-portal.ts`.
 *
 * ── L'ordre des branches est la règle ───────────────────────────────────────
 *
 * La cible annulée est évaluée **avant** « consommé ». C'est tout l'intérêt de
 * dériver : une séance que l'école annule rouvre le crédit sans qu'aucun
 * processus n'ait à défaire quoi que ce soit.
 */
export type MakeupCreditFacts = {
  status: "available" | "booked";
  /** Fin de la session d'où vient le crédit, ou prolongation décidée par l'école. */
  usableThrough: string | null;
  /** Date de la séance cible, si le crédit est réservé. */
  bookedOn: string | null;
  /** Statut de la séance cible — une annulation rouvre le crédit. */
  bookedOccurrenceStatus: string | null;
  /** Aujourd'hui, dans le fuseau de l'école — jamais celui du serveur. */
  today: string;
};

export function makeupCreditState(facts: MakeupCreditFacts): MakeupDerivedState {
  if (facts.status === "booked") {
    /**
     * Séance annulée : le crédit se rouvre. Évalué en premier, sans quoi un
     * rattrapage annulé après coup passerait pour consommé et l'enfant
     * perdrait sa séance sans que personne ne s'en aperçoive.
     */
    if (facts.bookedOccurrenceStatus === CANCELLED_OCCURRENCE_STATUS) {
      return isExpired(facts) ? "expired" : "available";
    }

    /** Séance passée : le rattrapage a eu lieu. */
    if (facts.bookedOn !== null && facts.bookedOn < facts.today) return "used";

    return "booked";
  }

  return isExpired(facts) ? "expired" : "available";
}

/**
 * Comparaison de dates **civiles**, jamais d'instants.
 *
 * `term.end_date` est un jour du calendrier de l'école ; le comparer à un
 * horodatage serveur ferait expirer un crédit une nuit trop tôt à l'ouest, une
 * nuit trop tard à l'est. Même discipline que la génération des séances.
 */
function isExpired(facts: MakeupCreditFacts): boolean {
  return facts.usableThrough !== null && facts.usableThrough < facts.today;
}

/** Un crédit utilisable est disponible — et rien d'autre. */
export function isMakeupUsable(facts: MakeupCreditFacts): boolean {
  return makeupCreditState(facts) === "available";
}
