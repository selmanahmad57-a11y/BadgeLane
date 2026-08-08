-- `sent` devient `accepted`.
--
-- Le fournisseur répond 200 pour dire « accepté pour livraison », jamais
-- « livré ». Un reçu a été marqué `sent` vers une adresse en `.invalid` :
-- Resend l'avait accepté, et rien n'est jamais arrivé.
--
-- Un statut ne doit affirmer que ce qu'il a observé — même distinction qu'entre
-- le retour du navigateur et la confirmation de paiement.

ALTER TABLE "outbound_email" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "email_delivery_status" RENAME TO "email_delivery_status_old";--> statement-breakpoint
CREATE TYPE "email_delivery_status" AS ENUM ('claimed', 'accepted', 'failed');--> statement-breakpoint
ALTER TABLE "outbound_email" ALTER COLUMN "status" TYPE "email_delivery_status"
  USING (case when "status"::text = 'sent' then 'accepted' else "status"::text end)::"email_delivery_status";--> statement-breakpoint
ALTER TABLE "outbound_email" ALTER COLUMN "status" SET DEFAULT 'claimed';--> statement-breakpoint
DROP TYPE "email_delivery_status_old";
