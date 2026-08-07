"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  CUSTOMER_PORTAL_LOCALE,
  isRecurringInterval,
  STRIPE_RECURRING_INTERVAL,
  TERM_INVOICE_DAYS_UNTIL_DUE,
  TUITION_INTERVALS,
} from "@/config/billing";
import { clientEnv } from "@/config/env.client";
import { isStripeConfigured } from "@/config/env.stripe";
import { routes } from "@/config/routes";
import { family, organization, tuitionPlan } from "@/db/schema";
import { withTenant, type TenantTransaction } from "@/db/tenant";
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
import { resolvePortalConfiguration } from "@/lib/stripe-portal";

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

// ─── Briques communes aux deux chemins de paiement ───────────────────────────

/**
 * Le tarif, vérifié comme appartenant à cette école.
 *
 * La contrainte de clé étrangère ne suffirait pas : elle accepterait le tarif
 * d'une école concurrente, dont l'identifiant aurait été soumis à la main.
 */
async function requirePlan(
  tx: TenantTransaction,
  organizationId: string,
  planId: string,
) {
  const [plan] = await tx
    .select({
      stripePriceId: tuitionPlan.stripePriceId,
      interval: tuitionPlan.interval,
      name: tuitionPlan.name,
    })
    .from(tuitionPlan)
    .where(
      and(
        eq(tuitionPlan.id, planId),
        eq(tuitionPlan.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!plan?.stripePriceId) {
    throw new ValidationError("Tarif introuvable.", "notInThisSchool");
  }

  return { ...plan, stripePriceId: plan.stripePriceId };
}

/**
 * Le client Stripe de la famille, créé au besoin puis mémorisé.
 *
 * Cette mémorisation n'est pas un cache : c'est elle qui permet au webhook de
 * retrouver la famille à partir du client. Sans elle, chaque paiement créerait
 * un doublon chez Stripe et le miroir n'aurait plus à quoi se rattacher.
 *
 * Écrit une seule fois plutôt que dans chaque flux : abonnement et facture
 * ponctuelle doivent aboutir au **même** client, sans quoi une famille se
 * retrouverait avec deux dossiers de paiement chez son école.
 */
async function ensureCustomer(
  tx: TenantTransaction,
  scoped: ReturnType<typeof forConnectedAccount>,
  organizationId: string,
  familyId: string,
): Promise<string> {
  const stripe = getStripe();
  if (!stripe) {
    throw new ValidationError("Stripe non configuré.", "stripeNotConfigured");
  }

  const [household] = await tx
    .select({
      email: family.email,
      name: family.primaryGuardianName,
      customerId: family.stripeCustomerId,
    })
    .from(family)
    .where(
      and(eq(family.id, familyId), eq(family.organizationId, organizationId)),
    )
    .limit(1);

  if (!household) {
    throw new ValidationError("Famille introuvable.", "notInThisSchool");
  }

  if (household.customerId) return household.customerId;

  const customer = await stripe.customers.create(
    {
      email: household.email,
      name: household.name,
      metadata: { familyId, organizationId },
    },
    scoped,
  );

  await tx
    .update(family)
    .set({ stripeCustomerId: customer.id })
    .where(eq(family.id, familyId));

  return customer.id;
}

/** Le compte connecté de l'école, sans lequel aucun encaissement n'est possible. */
async function requireConnectedAccount(
  tx: TenantTransaction,
  organizationId: string,
) {
  const [record] = await tx
    .select({
      stripeAccountId: organization.stripeAccountId,
      currency: organization.currency,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!record?.stripeAccountId) {
    throw new ValidationError(
      "L'école n'a pas encore connecté son compte Stripe.",
      "stripeNotConnected",
    );
  }

  return { ...record, stripeAccountId: record.stripeAccountId };
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

      /**
       * Un prix récurrent produit un abonnement ; un prix sans `recurring`
       * produit un paiement unique. C'est la seule différence entre les deux
       * chemins, et elle se joue ici.
       */
      const price = await stripe.prices.create(
        {
          currency: record.currency.toLowerCase(),
          unit_amount: amount,
          ...(isRecurringInterval(interval)
            ? { recurring: { interval: STRIPE_RECURRING_INTERVAL[interval] } }
            : {}),
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
      const account = await requireConnectedAccount(tx, context.organizationId);
      const scoped = forConnectedAccount(account.stripeAccountId);

      const plan = await requirePlan(tx, context.organizationId, planId);

      /**
       * Un tarif au trimestre n'a pas de prix récurrent : Stripe refuserait la
       * session d'abonnement. On refuse d'abord, avec un message qui dit quoi
       * faire à la place.
       */
      if (!isRecurringInterval(plan.interval)) {
        throw new ValidationError(
          "Ce tarif se facture à l'unité.",
          "planIsOneOff",
        );
      }

      const customerId = await ensureCustomer(
        tx,
        scoped,
        context.organizationId,
        familyId,
      );

      const returnUrl = `${clientEnv.NEXT_PUBLIC_APP_URL}/${clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE}${routes.billing}`;

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: plan.stripePriceId, quantity: 1 }],
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

/**
 * Ouvre le portail client de Stripe pour une famille.
 *
 * ── Le dunning est celui de Stripe ───────────────────────────────────────────
 *
 * Stripe relance déjà seul : nouvelles tentatives sur les abonnements, rappels
 * avant et après échéance sur les factures. Ces messages partent au nom de
 * l'**école**, puisque c'est elle le marchand — ce n'est pas un contournement,
 * c'est la conséquence directe de Connect Standard. Ils portent déjà le lien de
 * paiement hébergé que nous reflétons.
 *
 * BadgeLane n'a donc ni tâche planifiée ni fournisseur d'envoi à construire.
 * Son rôle est de **refléter** l'état par les webhooks et de montrer les
 * impayés à l'école. Ce portail complète le tableau : le parent y remplace la
 * carte qui a échoué.
 *
 * ── Pourquoi ne pas créer le client au passage ───────────────────────────────
 *
 * Une famille à qui rien n'a jamais été demandé n'a pas de dossier chez Stripe.
 * Lui en fabriquer un ouvrirait un portail vide — un écran qui ne dit pas ce
 * qui ne va pas. On refuse, avec le geste à faire à la place.
 */
export async function openCustomerPortal(
  formData: FormData,
): Promise<ActionResult> {
  /** Variable locale : une adresse de portail ne doit jamais être partagée. */
  let destination: string | null = null;

  const result = await runAuthorizedAction("billing:manage", async (context) => {
    const stripe = getStripe();
    if (!stripe) {
      throw new ValidationError("Stripe non configuré.", "stripeNotConfigured");
    }

    const familyId = requiredUuid(formData, "familyId");

    await withTenant(context.organizationId, async (tx) => {
      const account = await requireConnectedAccount(tx, context.organizationId);
      const scoped = forConnectedAccount(account.stripeAccountId);

      const [household] = await tx
        .select({ customerId: family.stripeCustomerId })
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

      if (!household.customerId) {
        throw new ValidationError(
          "Cette famille n'a encore aucun paiement.",
          "familyNotBilledYet",
        );
      }

      const configuration = await resolvePortalConfiguration(stripe, scoped);

      const session = await stripe.billingPortal.sessions.create(
        {
          customer: household.customerId,
          return_url: `${clientEnv.NEXT_PUBLIC_APP_URL}/${clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE}${routes.billing}`,
          locale: CUSTOMER_PORTAL_LOCALE,
          ...(configuration ? { configuration } : {}),
        },
        scoped,
      );

      destination = session.url;
    });
  });

  if (destination) redirect(destination);

  return result;
}

/**
 * Émet une facture au trimestre — un paiement unique, payé d'avance.
 *
 * ── Pourquoi une *Invoice* et non un abonnement ──────────────────────────────
 *
 * Un abonnement trimestriel se reconduirait. Il faudrait alors le résilier au
 * bon moment pour qu'il s'arrête après une saison — une échéance à tenir, donc
 * une échéance à rater. La facture ponctuelle n'a pas cette dette : émise une
 * fois, payée une fois, terminée.
 *
 * ── `send_invoice` plutôt que `charge_automatically` ─────────────────────────
 *
 * L'école n'a pas la carte du parent : c'est justement la famille qu'on veut
 * faire payer, à partir d'un lien. Stripe produit alors une page de paiement
 * hébergée et une échéance — celle-là même sur laquelle s'appuieront les
 * relances de la Semaine 9.
 *
 * ── Ce qui n'est PAS écrit ici ───────────────────────────────────────────────
 *
 * Aucune ligne dans la table `invoice`. Le miroir est écrit par le webhook, à
 * la réception de `invoice.created` puis `invoice.finalized`, à partir de
 * l'objet relu chez Stripe. Écrire aussi depuis ici créerait une seconde source
 * de vérité — et deux vérités finissent toujours par diverger.
 */
export async function issueTermInvoice(
  formData: FormData,
): Promise<ActionResult> {
  return runAuthorizedAction("billing:manage", async (context) => {
    const stripe = getStripe();
    if (!stripe) {
      throw new ValidationError("Stripe non configuré.", "stripeNotConfigured");
    }

    const familyId = requiredUuid(formData, "familyId");
    const planId = requiredUuid(formData, "planId");

    await withTenant(context.organizationId, async (tx) => {
      const account = await requireConnectedAccount(tx, context.organizationId);
      const scoped = forConnectedAccount(account.stripeAccountId);

      const plan = await requirePlan(tx, context.organizationId, planId);

      if (isRecurringInterval(plan.interval)) {
        throw new ValidationError(
          "Ce tarif est un abonnement.",
          "planIsRecurring",
        );
      }

      const customerId = await ensureCustomer(
        tx,
        scoped,
        context.organizationId,
        familyId,
      );

      /**
       * Stripe ne peut pas envoyer une facture à un client sans adresse. La
       * famille en a forcément une — le champ est requis depuis la Semaine 3 —
       * mais un client créé avant, ou modifié dans leur tableau de bord,
       * pourrait ne pas en avoir. On le vérifie plutôt que de le supposer.
       */
      const customer = await stripe.customers.retrieve(customerId, {}, scoped);
      if (customer.deleted || !customer.email) {
        throw new ValidationError(
          "Cette famille n'a pas d'adresse e-mail chez Stripe.",
          "familyHasNoEmail",
        );
      }

      /**
       * L'ordre compte. La facture est créée **vide** — `exclude` empêche
       * d'aspirer d'éventuelles lignes en attente sur ce client, qui
       * appartiendraient à une autre facturation. La ligne est ensuite
       * rattachée explicitement à celle-ci.
       */
      const draft = await stripe.invoices.create(
        {
          customer: customerId,
          collection_method: "send_invoice",
          days_until_due: TERM_INVOICE_DAYS_UNTIL_DUE,
          pending_invoice_items_behavior: "exclude",
          description: plan.name,
          metadata: {
            familyId,
            organizationId: context.organizationId,
            tuitionPlanId: planId,
          },
        },
        scoped,
      );

      await stripe.invoiceItems.create(
        {
          customer: customerId,
          invoice: draft.id,
          /**
           * `pricing.price` et non `price` : la version courante de l'API a
           * imbriqué le champ. Écrit à plat, il serait silencieusement ignoré
           * et la facture partirait à zéro.
           */
          pricing: { price: plan.stripePriceId },
          quantity: 1,
        },
        scoped,
      );

      /**
       * La finalisation est ce qui rend la facture payable : c'est elle qui
       * produit l'échéance et la page de paiement hébergée. Un brouillon ne
       * déclencherait ni relance ni paiement.
       */
      await stripe.invoices.finalizeInvoice(draft.id!, {}, scoped);
    });

    revalidatePath(`/[locale]${routes.billing}`, "page");
  });
}
