import "server-only";

import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";

import type { Locale } from "@/config/i18n";
import { i18nConfig } from "@/config/i18n";
import { family, invoice, organization } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import { resendAdapter } from "./resend";
import { composePaymentConfirmation } from "./compose";
import { sendOnce } from "./outbox";
import { isObviouslyUndeliverable } from "./deliverable";

/**
 * Confirmation de paiement — déclenchée par le webhook, jamais par un clic.
 *
 * ── Pourquoi elle vit HORS de la transaction du miroir ──────────────────────
 *
 * Le webhook écrit le miroir et marque l'événement traité dans une seule
 * transaction : deux écritures de base, que Postgres atomise vraiment. L'envoi,
 * lui, est un appel réseau irréversible — l'inclure ferait dépendre
 * l'enregistrement d'un paiement de la disponibilité d'un service tiers.
 *
 * Un e-mail qui n'part pas ne doit jamais annuler un paiement déjà enregistré.
 * Deux préoccupations de durabilité distinctes, deux mécanismes :
 * `stripe_event` empêche le webhook de se rejouer, `outbound_email` et la clé
 * d'idempotence empêchent le double envoi même si Stripe relivre.
 *
 * ── Le destinataire se dérive de la donnée ──────────────────────────────────
 *
 * De la facture vers la famille, et de la famille vers son adresse de contact.
 * Jamais l'inverse, et jamais depuis une entrée : la cible sensible vient de ce
 * qu'on a lu, comme l'identifiant client Stripe et l'identifiant d'élève.
 *
 * ── Pourquoi le CONTACT DU FOYER, et pas « les tuteurs » ────────────────────
 *
 * La première version joignait `guardian` sans `ORDER BY` : le destinataire
 * était donc indéfini, et le reçu est parti au second tuteur. Un commentaire
 * affirmait « celui renseigné en premier » — il mentait sur son propre code.
 *
 * Écrire à **tous** les tuteurs serait défendable — les deux parents veulent
 * savoir que l'argent est passé — mais deux choses l'interdisent aujourd'hui :
 *
 *  1. On ne saurait pas à qui on écrit. Un reçu est une donnée financière
 *     familiale, et rien dans `guardian` ne dit qu'une adresse est **vérifiée**.
 *     Le rattachement Clerk est dérivé à la connexion, jamais stocké — donc
 *     « tuteur vérifié » n'est pas représentable. Envoyer à une adresse que
 *     personne n'a confirmée serait une fuite sur simple faute de frappe.
 *  2. La clé d'idempotence devrait inclure le destinataire. Avec la clé
 *     actuelle — école, nature, sujet, période — le second tuteur serait
 *     dédoublonné comme un faux doublon du premier : une sous-livraison
 *     silencieuse, pire qu'un envoi manquant qu'on voit.
 *
 * Un destinataire, donc, et une clé inchangée. Le jour où la vérification
 * existera, les deux évolueront **ensemble**.
 */
export async function sendPaymentConfirmation(
  organizationId: string,
  remote: Stripe.Invoice,
): Promise<void> {
  const adapter = resendAdapter();

  /** Instance sans envoi configuré : le paiement reste enregistré. */
  if (!adapter) return;

  const context = await withTenant(organizationId, async (tx) => {
    const [row] = await tx
      .select({
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        schoolName: organization.name,
        recipient: family.email,
        guardianName: family.primaryGuardianName,
        preferredLanguage: family.preferredLanguage,
      })
      .from(invoice)
      .innerJoin(family, eq(family.id, invoice.familyId))
      .innerJoin(organization, eq(organization.id, invoice.organizationId))
      .where(
        and(
          eq(invoice.organizationId, organizationId),
          eq(invoice.stripeInvoiceId, remote.id!),
        ),
      )
      .limit(1);

    return row ?? null;
  });

  /** Facture d'une famille inconnue : rien à confirmer à personne. */
  if (!context?.recipient) return;

  /**
   * Une adresse qu'on sait indélivrable n'est pas envoyée — et surtout pas
   * comptée comme acceptée. C'est ainsi qu'un reçu vers `.invalid` avait été
   * marqué envoyé alors que rien n'était parti.
   */
  if (isObviouslyUndeliverable(context.recipient)) return;

  const locale = (
    (i18nConfig.locales as readonly string[]).includes(context.preferredLanguage)
      ? context.preferredLanguage
      : i18nConfig.defaultLocale
  ) as Locale;

  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: context.currency.toUpperCase(),
  }).format(context.amount / 100);

  await sendOnce(
    {
      organizationId,
      kind: "payment_confirmation",
      subjectId: context.invoiceId,
      recipient: context.recipient,
    },
    adapter,
    () =>
      composePaymentConfirmation(locale, {
        guardian: context.guardianName,
        school: context.schoolName,
        amount,
      }),
  );
}
