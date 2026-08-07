import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { stripeEnv } from "@/config/env.stripe";
import { db } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { stripeEvent } from "@/db/schema";
import { resolveOrganizationForAccount } from "@/db/stripe-lookup";
import { withTenant } from "@/db/tenant";
import { forConnectedAccount, getStripe } from "@/lib/stripe";
import { mirrorInvoice, mirrorSubscription } from "@/lib/stripe-mirror";

/**
 * Réception des événements Stripe — l'endpoint le plus exposé du produit.
 *
 * Publiquement joignable, sans session, et il décide de ce qui est payé. Trois
 * pièges, trois réponses.
 *
 * ── 1. SIGNATURE ─────────────────────────────────────────────────────────────
 *
 * N'importe qui peut poster ici. Sans vérification, n'importe qui pourrait
 * marquer une facture payée. Le corps brut est donc validé contre la signature
 * **avant que quoi que ce soit n'en soit lu**. Une signature absente ou fausse
 * s'arrête à 400 sans qu'une seule ligne de la charge utile ne soit interprétée.
 *
 * ── 2. IDEMPOTENCE ───────────────────────────────────────────────────────────
 *
 * Stripe retente : le même événement arrivera plusieurs fois. Son identifiant
 * est la clé primaire de `stripe_event` — un doublon est donc une violation de
 * contrainte, impossible plutôt que détectée.
 *
 * Surtout, cette insertion et l'écriture du miroir sont dans **une seule
 * transaction**. Un plantage entre les deux ne laisse rien : ni ligne
 * d'événement, ni miroir à moitié écrit. Le retry de Stripe repart d'un état
 * propre, sans logique particulière.
 *
 * La version précédente marquait l'événement traité en deux temps. Un plantage
 * entre les deux aurait laissé une ligne « reçue mais non traitée » que le
 * retry aurait prise pour un doublon — et une mise à jour de paiement se serait
 * perdue en silence.
 *
 * ── 3. ORDRE ─────────────────────────────────────────────────────────────────
 *
 * Les événements n'arrivent pas dans l'ordre où ils se sont produits. Plutôt
 * que de comparer des horodatages pour deviner si l'un est périmé, l'objet est
 * **relu chez Stripe** et son état courant est écrit. L'ordre cesse d'être un
 * problème parce qu'on ne s'en sert plus : l'événement dit *quoi* rafraîchir,
 * pas *quel est* l'état.
 *
 * C'est la même discipline que partout ailleurs — on ne stocke pas un instant
 * qu'on peut recalculer, on ne stocke pas un badge qu'on peut dériver, on
 * n'ordonne pas des événements qu'on peut relire.
 */

/** Événements suivis. Tout le reste reçoit 200 sans traitement. */
const HANDLED = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = stripeEnv.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !secret) {
    /** Instance sans facturation : on refuse plutôt que d'accepter à vide. */
    return new Response("billing not configured", { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  /** Le corps **brut** : toute désérialisation préalable invaliderait la signature. */
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
    );
  } catch {
    /** Rien de la charge utile n'a été lu, et rien ne le sera. */
    return new Response("invalid signature", { status: 400 });
  }

  /**
   * À partir d'ici seulement, la charge utile est digne de confiance : elle a
   * prouvé venir de Stripe. C'est ce qui rend acceptable la lecture de la vue
   * qui échappe à la RLS.
   */
  const accountId = event.account;
  if (!accountId) {
    /** Événement de la plateforme, pas d'une école. Rien à refléter. */
    return new Response("ignored", { status: 200 });
  }

  const organizationId = await resolveOrganizationForAccount(db, accountId);
  if (!organizationId) {
    /**
     * Compte inconnu — un compte créé hors BadgeLane, par exemple. Répondre 200
     * plutôt que 500 : Stripe ne doit pas retenter indéfiniment un événement
     * que nous ne saurons jamais traiter.
     */
    return new Response("unknown account", { status: 200 });
  }

  if (!HANDLED.has(event.type)) {
    return new Response("ignored", { status: 200 });
  }

  try {
    const scoped = forConnectedAccount(accountId);

    /**
     * Relecture avant la transaction : l'appel réseau ne doit pas se faire
     * pendant qu'une transaction est ouverte.
     */
    const objectId = (event.data.object as { id?: string }).id;
    if (!objectId) return new Response("ignored", { status: 200 });

    const fresh = event.type.startsWith("customer.subscription.")
      ? await stripe.subscriptions.retrieve(objectId, {}, scoped)
      : await stripe.invoices.retrieve(objectId, {}, scoped);

    await withTenant(organizationId, async (tx) => {
      /**
       * D'abord l'événement : un doublon fait échouer la transaction entière
       * avant qu'aucun miroir ne soit touché.
       */
      await tx.execute(
        sql`insert into ${stripeEvent} (id, type) values (${event.id}, ${event.type})`,
      );

      if (fresh.object === "subscription") {
        await mirrorSubscription(tx, organizationId, fresh);
      } else {
        await mirrorInvoice(tx, organizationId, fresh);
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      /**
       * Déjà traité, et intégralement : rien à refaire. Répondre 200 est ici
       * la seule réponse correcte — un 500 ferait retenter Stripe sur un
       * événement dont le doublon est justement la preuve qu'il est acquis.
       */
      return new Response("duplicate", { status: 200 });
    }

    /**
     * Toute autre défaillance : ne pas répondre 200. Stripe retentera, et la
     * transaction annulée garantit qu'il repartira d'un état propre.
     */
    console.error("[stripe webhook]", event.id, event.type, error);
    return new Response("processing failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
