-- Page de paiement hébergée, reflétée depuis Stripe.
--
-- C'est l'adresse qu'on transmettra au parent — le futur *text-to-pay*. Elle
-- est recopiée de l'objet relu chez Stripe, jamais fabriquée : construire une
-- URL Stripe à partir d'un identifiant reviendrait à parier sur la forme de
-- leurs adresses, et ce pari finirait par se perdre en silence.
--
-- Nullable : Stripe ne la produit qu'à la finalisation de la facture.

ALTER TABLE "invoice" ADD COLUMN "hosted_invoice_url" text;
