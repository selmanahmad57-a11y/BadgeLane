-- Facturation au trimestre : un paiement unique, pas un abonnement.
--
-- `term` rejoint les rythmes proposés par une école, mais il ne suit pas le
-- même chemin chez Stripe. `weekly` et `monthly` produisent un prix récurrent
-- et un abonnement ; `term` produit un prix ponctuel et une *Invoice* émise une
-- fois. Le construire avec un abonnement trimestriel obligerait à le résilier
-- au bon moment pour qu'il ne se reconduise pas — une échéance à tenir là où
-- une facture ponctuelle n'en demande aucune.
--
-- `STRIPE_RECURRING_INTERVAL` (`src/config/billing.ts`) reste volontairement
-- partielle : `term` n'y figure pas, donc aucun appel ne peut lui demander un
-- intervalle récurrent par inadvertance.

ALTER TYPE "public"."tuition_interval" ADD VALUE 'term';
