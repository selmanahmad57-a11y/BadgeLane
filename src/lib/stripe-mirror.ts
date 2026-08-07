import "server-only";

import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";

import { family, invoice, subscription, tuitionPlan } from "@/db/schema";
import type { TenantTransaction } from "@/db/tenant";

/**
 * Écriture du miroir : ce que Stripe dit, recopié chez nous.
 *
 * Aucune décision n'est prise ici. Les statuts, les montants et les dates
 * viennent de l'objet relu chez Stripe — jamais de la charge utile de
 * l'événement, jamais d'un calcul de notre part.
 *
 * C'est la conséquence directe du choix de conception : Stripe détient la
 * vérité, notre base en est le reflet. Un miroir qui « corrigerait » ce qu'il
 * reflète serait un second système de vérité, et deux vérités finissent
 * toujours par diverger.
 */

/** Retrouve la famille d'un client Stripe. `null` si elle nous est inconnue. */
async function findFamilyByCustomer(
  tx: TenantTransaction,
  organizationId: string,
  customerId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: family.id })
    .from(family)
    .where(
      and(
        eq(family.organizationId, organizationId),
        eq(family.stripeCustomerId, customerId),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

function customerIdOf(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export async function mirrorSubscription(
  tx: TenantTransaction,
  organizationId: string,
  remote: Stripe.Subscription,
): Promise<void> {
  const customerId = customerIdOf(remote.customer);
  if (!customerId) return;

  const familyId = await findFamilyByCustomer(tx, organizationId, customerId);

  /**
   * Un abonnement dont le client ne correspond à aucune famille n'est pas une
   * erreur : il peut avoir été créé directement dans le tableau de bord de
   * l'école. On ne l'invente pas côté BadgeLane.
   */
  if (!familyId) return;

  /** Le plan est retrouvé par le prix ; absent, l'abonnement reste orphelin. */
  const priceId = remote.items.data[0]?.price?.id;
  const [plan] = priceId
    ? await tx
        .select({ id: tuitionPlan.id })
        .from(tuitionPlan)
        .where(
          and(
            eq(tuitionPlan.organizationId, organizationId),
            eq(tuitionPlan.stripePriceId, priceId),
          ),
        )
        .limit(1)
    : [];

  const periodEnd = remote.items.data[0]?.current_period_end;

  await tx
    .insert(subscription)
    .values({
      organizationId,
      familyId,
      tuitionPlanId: plan?.id ?? null,
      stripeSubscriptionId: remote.id,
      status: remote.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .onConflictDoUpdate({
      target: [subscription.organizationId, subscription.stripeSubscriptionId],
      set: {
        familyId,
        tuitionPlanId: plan?.id ?? null,
        status: remote.status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      },
    });
}

export async function mirrorInvoice(
  tx: TenantTransaction,
  organizationId: string,
  remote: Stripe.Invoice,
): Promise<void> {
  const customerId = customerIdOf(remote.customer);
  if (!customerId) return;

  const familyId = await findFamilyByCustomer(tx, organizationId, customerId);
  if (!familyId) return;

  await tx
    .insert(invoice)
    .values({
      organizationId,
      familyId,
      stripeInvoiceId: remote.id!,
      amount: remote.amount_due,
      currency: remote.currency,
      status: remote.status ?? "draft",
      dueDate: remote.due_date ? new Date(remote.due_date * 1000) : null,
      /**
       * `status_transitions.paid_at` plutôt que « maintenant » : la date qui
       * compte est celle du paiement, pas celle où l'événement nous parvient.
       * Un webhook rejoué trois jours plus tard ne doit pas réécrire l'histoire.
       */
      paidAt: remote.status_transitions?.paid_at
        ? new Date(remote.status_transitions.paid_at * 1000)
        : null,
      hostedInvoiceUrl: remote.hosted_invoice_url ?? null,
    })
    .onConflictDoUpdate({
      target: [invoice.organizationId, invoice.stripeInvoiceId],
      set: {
        amount: remote.amount_due,
        currency: remote.currency,
        status: remote.status ?? "draft",
        dueDate: remote.due_date ? new Date(remote.due_date * 1000) : null,
        paidAt: remote.status_transitions?.paid_at
          ? new Date(remote.status_transitions.paid_at * 1000)
          : null,
        hostedInvoiceUrl: remote.hosted_invoice_url ?? null,
      },
    });
}
