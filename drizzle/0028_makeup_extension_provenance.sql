-- Provenance de la prolongation d'un crédit de rattrapage.
--
-- `extended_until` seul dirait QUE le crédit a été prolongé, sans dire PAR QUI.
-- Six mois plus tard, personne ne saurait distinguer un geste commercial
-- assumé d'une manipulation oubliée.
--
-- Une décision se stocke, une conséquence se dérive — et une décision mérite sa
-- provenance. Même règle que `enrolled_by_guardian_id`.

ALTER TABLE "makeup_credit" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "makeup_credit" ALTER COLUMN "status" SET DEFAULT 'available'::text;--> statement-breakpoint
DROP TYPE "public"."makeup_credit_status";--> statement-breakpoint
CREATE TYPE "public"."makeup_credit_status" AS ENUM('available', 'booked');--> statement-breakpoint
ALTER TABLE "makeup_credit" ALTER COLUMN "status" SET DEFAULT 'available'::"public"."makeup_credit_status";--> statement-breakpoint
ALTER TABLE "makeup_credit" ALTER COLUMN "status" SET DATA TYPE "public"."makeup_credit_status" USING "status"::"public"."makeup_credit_status";--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD COLUMN "extended_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD COLUMN "extended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "makeup_credit" ADD CONSTRAINT "makeup_credit_extended_by_staff_user_id_staff_user_id_fk" FOREIGN KEY ("extended_by_staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;