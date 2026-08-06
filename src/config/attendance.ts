/**
 * États de présence relevés au bord du bassin.
 *
 * `makeup` figure au §3 du blueprint mais n'entre pas ici : les rattrapages
 * arrivent en Semaine 10. Même discipline que pour les champs de facturation
 * repoussés en Semaine 3 — on n'ajoute pas une valeur que rien ne produit.
 */
export const ATTENDANCE_STATUSES = ["present", "absent", "excused"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
