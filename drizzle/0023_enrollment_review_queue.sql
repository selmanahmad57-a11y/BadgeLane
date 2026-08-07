-- File de revue des inscriptions : un ÉTAT, pas une fenêtre de temps.
--
-- La première idée était d'afficher « les inscriptions des N derniers jours ».
-- Elle a un défaut silencieux : une inscription douteuse faite pendant une
-- semaine chargée sort de la fenêtre avant que quiconque l'ait regardée — et
-- c'est précisément en haute saison, quand il y en a le plus et que le risque
-- est le plus grand, qu'elle défile hors de vue.
--
-- Avec un état, rien ne disparaît sans que quelqu'un l'ait vu : la file se vide
-- parce qu'on la traite, pas parce que le temps passe.
--
-- C'est ce qui rend exerçable le droit de retrait de l'école — le contrepoids
-- du choix « active direct ». Sans lui, « l'école garde la main » serait une
-- promesse que l'écran ne tient pas.

ALTER TABLE "enrollment" ADD COLUMN "reviewed_at" timestamp with time zone;