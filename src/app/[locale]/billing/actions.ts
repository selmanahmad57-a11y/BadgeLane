"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { STRIPE_RECURRING_INTERVAL, TUITION_INTERVALS } from "@/config/billing";
import { clientEnv } from "@/config/env.client";
import { isStripeConfigured } from "@/config/env.stripe";
import { routes } from "@/config/routes";
import { family, organization, tuitionPlan } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { ActionResult } from "@/lib/action-result";
import {
  requiredEnum,
  requiredText,
  requiredUuid,
  runAuthorizedAction,
  ValidationError,
} from "@/lib/actions";
import { FIELD_LIMITS } from "@/config/validation";
import {
  connectedAccountConfiguration,
  forConnectedAccount,
  getStripe,
} from "@/lib/stripe";

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

      const account = await stripe.v2.core.accounts.create({
        ...connectedAccountConfiguration(record.country),
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

    const link = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          return_url: returnUrl,
          /** Reprise si l'école abandonne en cours de route. */
          refresh_url: returnUrl,
        },
      },
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

// ─── Plans tarifaires ────────────────────────────────────────────────────────

/**
 * Crée un tarif de scolarité et son prix Stripe.
 *
 * Le prix est créé **sur le compte de l'école**, pas sur celui de la
 * plateforme : c'est elle le marchand. Oublier `stripeAccount` créerait le prix
 * chez nous, et les paiements arriveraient sur le mauvais compte — une
 * confusion de tenant, aussi grave qu'une requête SQL sans contexte.
 */
export async function createTuitionPlan(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("billing:manage", async (context) => {
    const stripe = getStripe();
    if (!stripe) {
      throw new ValidationError("Stripe non configuré.", "stripeNotConfigured");
    }

    const name = requiredText(formData, "name", FIELD_LIMITS.name);
    const interval = requiredEnum(formData, "interval", TUITION_INTERVALS);

    /**
     * Le montant est saisi en unités courantes (« 45,50 ») et stocké en
     * centimes. La conversion se fait ici, une seule fois : manipuler des
     * flottants plus loin finirait par produire un centime qui n'existe pas.
     */
    const rawAmount = formData.get("amount");
    const major = Number(String(rawAmount).replace(",", "."));

    if (!Number.isFinite(major) || major <= 0) {
      throw new ValidationError(`Montant « ${String(rawAmount)} » invalide.`);
    }

    const amount = Math.round(major * 100);

    await withTenant(context.organizationId, async (tx) => {
      const [record] = await tx
        .select({
          stripeAccountId: organization.stripeAccountId,
          currency: organization.currency,
          name: organization.name,
        })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!record?.stripeAccountId) {
        throw new ValidationError(
          "L'école n'a pas encore connecté son compte Stripe.",
          "stripeNotConnected",
        );
      }

      const price = await stripe.prices.create(
        {
          currency: record.currency.toLowerCase(),
          unit_amount: amount,
          recurring: { interval: STRIPE_RECURRING_INTERVAL[interval] },
          product_data: { name },
          metadata: { organizationId: context.organizationId },
        },
        forConnectedAccount(record.stripeAccountId),
      );

      await tx.insert(tuitionPlan).values({
        organizationId: context.organizationId,
        name,
        amount,
        interval,
        stripePriceId: price.id,
      });
    });

    revalidatePath(`/[locale]${routes.billing}`, "page");
  });
}

/**
 * Ouvre un paiement hébergé pour abonner une famille.
 *
 * Le formulaire de carte est servi par Stripe, sur son domaine : aucune donnée
 * bancaire ne traverse nos serveurs. C'est ce qui met BadgeLane hors du
 * périmètre PCI.
 *
 * L'action renvoie l'adresse plutôt que d'y rediriger l'administrateur : c'est
 * la **famille** qui doit payer, pas lui. Le lien lui sera transmis — l'envoi
 * automatique arrive en Semaine 9 avec les relances.
 */
export async function createCheckoutLink(
  formData: FormData,
): Promise<ActionResult> {
  /**
   * Variable **locale**, jamais au niveau module : une valeur partagée entre
   * requêtes servirait l'adresse de paiement d'une école à une autre.
   */
  let destination: string | null = null;

  const result = await runAuthorizedAction("billing:manage", async (context) => {
    const stripe = getStripe();
    if (!stripe) {
      throw new ValidationError("Stripe non configuré.", "stripeNotConfigured");
    }

    const familyId = requiredUuid(formData, "familyId");
    const planId = requiredUuid(formData, "planId");

    await withTenant(context.organizationId, async (tx) => {
      const [record] = await tx
        .select({
          stripeAccountId: organization.stripeAccountId,
          currency: organization.currency,
        })
        .from(organization)
        .where(eq(organization.id, context.organizationId))
        .limit(1);

      if (!record?.stripeAccountId) {
        throw new ValidationError(
          "L'école n'a pas encore connecté son compte Stripe.",
          "stripeNotConnected",
        );
      }

      const scoped = forConnectedAccount(record.stripeAccountId);

      const [plan] = await tx
        .select({ priceId: tuitionPlan.stripePriceId })
        .from(tuitionPlan)
        .where(
          and(
            eq(tuitionPlan.id, planId),
            eq(tuitionPlan.organizationId, context.organizationId),
          ),
        )
        .limit(1);

      if (!plan?.priceId) {
        throw new ValidationError("Tarif introuvable.", "notInThisSchool");
      }

      const [household] = await tx
        .select({
          email: family.email,
          name: family.primaryGuardianName,
          customerId: family.stripeCustomerId,
        })
        .from(family)
        .where(
          and(
            eq(family.id, familyId),
            eq(family.organizationId, context.organizationId),
          ),
        )
        .limit(1);

      if (!household) {
        throw new ValidationError("Famille introuvable.", "notInThisSchool");
      }

      /**
       * Le client Stripe est créé sur le compte de l'école, puis mémorisé. Sans
       * cette mémorisation, chaque paiement créerait un doublon et le webhook ne
       * saurait plus à quelle famille rattacher l'abonnement.
       */
      let customerId = household.customerId;

      if (!customerId) {
        const customer = await stripe.customers.create(
          {
            email: household.email,
            name: household.name,
            metadata: { familyId, organizationId: context.organizationId },
          },
          scoped,
        );

        customerId = customer.id;

        await tx
          .update(family)
          .set({ stripeCustomerId: customerId })
          .where(eq(family.id, familyId));
      }

      const returnUrl = `${clientEnv.NEXT_PUBLIC_APP_URL}/${clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE}${routes.billing}`;

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: plan.priceId, quantity: 1 }],
          success_url: returnUrl,
          cancel_url: returnUrl,
          metadata: { familyId, organizationId: context.organizationId },
          /**
           * Aucune commission de plateforme (§6). Exprimé par l'absence
           * d'`application_fee_percent` : le jour où le modèle changerait, c'est
           * ici qu'une valeur se poserait, sans reprendre l'intégration.
           */
        },
        scoped,
      );

      destination = session.url;
    });
  });

  /**
   * Redirection hors du bloc, comme pour l'onboarding : `redirect()` lève une
   * exception, qui serait interceptée par la gestion d'erreurs de l'action et
   * transformée en échec silencieux.
   */
  if (destination) redirect(destination);

  return result;
}
