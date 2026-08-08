import { sql } from "drizzle-orm";

import type { EmailKind } from "@/config/email";
import { isUniqueViolation } from "@/db/errors";
import { outboundEmail } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import type { EmailAdapter, OutboundMessage } from "./adapter";

/**
 * Envoyer une fois, et une seule.
 *
 * ── Pourquoi ce n'est PAS le motif du webhook Stripe ────────────────────────
 *
 * À la Semaine 8, insérer l'événement et écrire le miroir dans une seule
 * transaction rendait « à demi traité » impossible — parce que les deux côtés
 * étaient la base, et qu'une transaction les atomise vraiment.
 *
 * Ici, l'un des deux côtés est un appel HTTP. Postgres ne peut pas l'envelopper.
 * Le cas « l'envoi échoue, la transaction annule » serait propre ; l'inverse ne
 * l'est pas : **l'envoi réussit, le processus meurt avant le `commit`**, la
 * ligne disparaît et l'e-mail est parti quand même. Le passage suivant le
 * renverrait. Aucune transaction ne ferme cette fenêtre, parce que l'action
 * irréversible vit dehors.
 *
 * ── La séquence, dont l'ordre porte la garantie ─────────────────────────────
 *
 * 1. **Réclamer, et valider.** L'unicité `(école, nature, sujet, période)`
 *    arrête les déclenchements concurrents — un cron qui rejoue, un envoi
 *    manuel qui chevauche l'automatique.
 * 2. **Envoyer hors transaction**, la même clé transmise au fournisseur comme
 *    clé d'idempotence. C'est là que se ferme la fenêtre restante.
 * 3. **Marquer le résultat.**
 *
 * Deux mécanismes, parce qu'un côté est externe. La déduplication se fait là où
 * l'action irréversible se fait.
 *
 * ── Ce que ça donne en prime ────────────────────────────────────────────────
 *
 * Un envoi en masse devient **reprenable** : un plantage à la cinquantième
 * famille reprend à la cinquante-et-unième, les cinquante premières ayant leur
 * ligne réclamée.
 */
export type OutboxClaim = {
  organizationId: string;
  kind: EmailKind;
  subjectId: string;
  /** Période couverte. Chaîne vide pour un transactionnel — jamais `null`. */
  period?: string;
  recipient: string;
};

export type OutboxOutcome = "sent" | "already_handled" | "failed";

/** La clé transmise au fournisseur : la même que celle qui borne la table. */
export function idempotencyKeyFor(claim: OutboxClaim): string {
  return [claim.organizationId, claim.kind, claim.subjectId, claim.period ?? ""]
    .join(":");
}

export async function sendOnce(
  claim: OutboxClaim,
  adapter: EmailAdapter,
  compose: () => Omit<OutboundMessage, "to" | "idempotencyKey" | "kind">,
): Promise<OutboxOutcome> {
  const period = claim.period ?? "";

  /**
   * 1. Réclamer — et valider immédiatement. La transaction ne contient QUE
   *    l'insertion : aucun appel réseau ne la tient ouverte, ce qui compte
   *    derrière un pooler en mode transaction.
   */
  try {
    await withTenant(claim.organizationId, async (tx) => {
      await tx.insert(outboundEmail).values({
        organizationId: claim.organizationId,
        kind: claim.kind,
        subjectId: claim.subjectId,
        period,
        recipient: claim.recipient,
      });
    });
  } catch (error) {
    /**
     * Déjà réclamé : quelqu'un d'autre s'en occupe, ou s'en est occupé. Ce
     * n'est pas une panne — c'est la contrainte qui fait son travail.
     */
    if (isUniqueViolation(error)) return "already_handled";
    throw error;
  }

  const composed = compose();

  try {
    /** 2. Envoyer, HORS transaction, avec la clé au fournisseur. */
    await adapter.send({
      ...composed,
      to: claim.recipient,
      kind: claim.kind,
      idempotencyKey: idempotencyKeyFor(claim),
    });
  } catch (error) {
    /**
     * 3'. L'échec est enregistré plutôt que masqué. La ligne reste — donc
     * aucun rejeu automatique ne partira derrière notre dos — et l'école peut
     * voir ce qui n'est pas parti.
     */
    await withTenant(claim.organizationId, async (tx) => {
      await tx.execute(
        sql`update ${outboundEmail}
               set status = 'failed',
                   failure_reason = ${String((error as Error)?.message ?? error).slice(0, 500)}
             where organization_id = ${claim.organizationId}
               and kind = ${claim.kind}
               and subject_id = ${claim.subjectId}::uuid
               and period = ${period}`,
      );
    });

    return "failed";
  }

  /** 3. Marquer. */
  await withTenant(claim.organizationId, async (tx) => {
    await tx.execute(
      sql`update ${outboundEmail}
             set status = 'sent', sent_at = now()
           where organization_id = ${claim.organizationId}
             and kind = ${claim.kind}
             and subject_id = ${claim.subjectId}::uuid
             and period = ${period}`,
    );
  });

  return "sent";
}
