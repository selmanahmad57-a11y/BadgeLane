-- RLS forcée sur `makeup_credit`.
--
-- Drizzle ACTIVE la RLS dès qu'une politique est déclarée, mais ne la FORCE
-- pas. Sans `FORCE`, le propriétaire de la table échappe à ses propres
-- politiques — et sur Neon, c'est le rôle qui applique les migrations.
--
-- Ce n'est pas une découverte : c'est le piège de la Semaine 1, et il revient
-- à chaque nouvelle table. `db:verify` l'a signalé avant qu'il n'atteigne quoi
-- que ce soit — une table restreinte sans RLS forcée ne restreint rien.

ALTER TABLE "makeup_credit" FORCE ROW LEVEL SECURITY;
