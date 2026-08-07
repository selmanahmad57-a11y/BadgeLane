-- Provenance d'une inscription : qui l'a faite.
--
-- Ce n'est pas un état dérivable. Passé l'instant de l'écriture, plus rien ne
-- permet de savoir si une inscription vient du bureau de l'école ou du canapé
-- d'un parent — on la garde, ou on la perd.
--
-- Elle porte tout le contrepoids du choix « active direct » : l'école
-- n'approuve pas en amont, elle relit en aval. Sans savoir lesquelles viennent
-- des familles, sa relecture serait noyée dans ses propres saisies, et le droit
-- de retrait deviendrait une promesse que l'écran ne tient pas.
--
-- `set null` : perdre le tuteur ne doit pas emporter l'inscription de l'enfant.

ALTER TABLE "enrollment" ADD COLUMN "enrolled_by_guardian_id" uuid;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_enrolled_by_guardian_id_guardian_id_fk" FOREIGN KEY ("enrolled_by_guardian_id") REFERENCES "public"."guardian"("id") ON DELETE set null ON UPDATE no action;