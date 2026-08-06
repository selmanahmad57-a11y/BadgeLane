-- RLS forcée et unicité d'une inscription vivante.
--
-- 1. FORCE : même raison qu'aux migrations 0001, 0003, 0005 et 0007. Postgres
--    exempte par défaut le propriétaire d'une table de ses propres politiques.

ALTER TABLE "enrollment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. Index unique PARTIEL — c'est le mot « partiel » qui fait tout le travail.
--
--    Un élève ne peut avoir qu'une seule inscription *vivante* par cours :
--    impossible d'être à la fois inscrit et en liste d'attente au même cours,
--    ou d'y être inscrit deux fois.
--
--    Les inscriptions closes (`ended`) sont exclues de la contrainte, à dessein.
--    Un élève qui quitte un cours en octobre doit pouvoir y revenir en janvier,
--    et les deux passages doivent subsister. Un index unique complet
--    l'interdirait : il faudrait effacer l'historique pour permettre le retour.
--
--    Cette contrainte est aussi le dernier filet du contrôle de capacité : même
--    si le verrou applicatif était contourné, une double inscription du même
--    élève resterait impossible.

CREATE UNIQUE INDEX "enrollment_live_student_klass_key"
  ON "enrollment" ("organization_id", "klass_id", "student_id")
  WHERE "status" IN ('active', 'waitlisted', 'paused');
