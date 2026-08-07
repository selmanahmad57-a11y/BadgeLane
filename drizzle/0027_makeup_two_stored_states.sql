-- Le statut d'un crédit ne connaît plus que deux valeurs.
--
-- « Consommé » rejoint « expiré » du côté dérivé. Ce n'est pas une
-- simplification cosmétique : c'est ce qui rend correct le cas de la séance
-- cible ANNULÉE.
--
-- Un crédit réservé sur une séance que l'école annule doit redevenir
-- réservable. Dérivé, c'est gratuit — la cible annulée sort des branches
-- « réservé » et « consommé », et le crédit se rouvre tout seul. Stocké, il
-- faudrait un processus pour DÉFAIRE la consommation à chaque annulation, et ce
-- processus oublierait un cas.
--
-- Une transition qu'on n'a pas écrite ne peut pas être oubliée.

ALTER TABLE "makeup_credit" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "makeup_credit_status" RENAME TO "makeup_credit_status_old";--> statement-breakpoint
CREATE TYPE "makeup_credit_status" AS ENUM ('available', 'booked');--> statement-breakpoint
ALTER TABLE "makeup_credit" ALTER COLUMN "status" TYPE "makeup_credit_status"
  USING "status"::text::"makeup_credit_status";--> statement-breakpoint
ALTER TABLE "makeup_credit" ALTER COLUMN "status" SET DEFAULT 'available';--> statement-breakpoint
DROP TYPE "makeup_credit_status_old";
