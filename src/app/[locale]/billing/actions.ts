"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { clientEnv } from "@/config/env.client";
import { isStripeConfigured } from "@/config/env.stripe";
import { routes } from "@/config/routes";
import { organization } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { ActionResult } from "@/lib/action-result";
import { runAuthorizedAction, ValidationError } from "@/lib/actions";
import { getStripe } from "@/lib/stripe";

/**
 * Connexion du compte Stripe de l'école, en Connect **Standard**.
 *
 * L'école devient marchand : les frais de scolarité vont sur son compte, et
 * BadgeLane ne touche ni cartes ni fonds. C'est ce choix qui met la plateforme
 * hors PCI et hors responsabilité de remboursement (§6 du blueprint).
 *
 * L'onboarding passe par les *Account Links* de Stripe : un formulaire hébergé
 * par eux, où l'école saisit ses informations bancaires et d'identité. Aucune
 * de ces données ne transite par BadgeLane — nous n'en conservons que
 * l'identifiant du compte.
 */

/** Aucune commission sur la scolarité (§6). Voir `PLATFORM_FEE_BASIS_POINTS`. */
export async function startStripeOnboarding(): Promise<ActionResult> {
  let destination: string | null = null;

  const result = await runAuthorizedAction("billing:manage", async (context) => {
    const stripe = getStripe();

    if (!stripe || !isStripeConfigured) {
      throw new ValidationError(
        "Stripe n'est pas configuré sur cette instance.",
        "stripeNotConfigured",
      );
    }

    const accountId = await withTenant(context.organizationId, async (tx) => {
      const [record] = await tx
        .select({
          stripeAccountId: organization.stripeAccountId,
          name: organization.name,
          country: organization.country,
        })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!record) {
        throw new ValidationError("École introuvable.", "notInThisSchool");
      }

      /** Compte déjà créé : on reprend l'onboarding là où il s'est arrêté. */
      if (record.stripeAccountId) return record.stripeAccountId;

      const account = await stripe.accounts.create({
        type: "standard",
        country: record.country,
        /**
         * L'identifiant de l'école voyage dans les métadonnées : les
         * événements de webhook le rapporteront, ce qui évite une résolution
         * supplémentaire dans le chemin le plus critique de l'application.
         */
        metadata: { organizationId: context.organizationId },
      });

      await tx
        .update(organization)
        .set({ stripeAccountId: account.id })
        .where(eq(organization.id, context.organizationId));

      return account.id;
    });

    const returnUrl = `${clientEnv.NEXT_PUBLIC_APP_URL}/${clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE}${routes.billing}`;

    const link = await stripe.accountLinks.create({
      account: accountId,
      /** Reprise si l'école abandonne en cours de route. */
      refresh_url: returnUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    destination = link.url;
  });

  /**
   * La redirection a lieu hors du bloc : `redirect()` fonctionne en levant une
   * exception, qui serait interceptée par la gestion d'erreurs de l'action et
   * transformée en échec silencieux.
   */
  if (destination) redirect(destination);

  return result;
}
