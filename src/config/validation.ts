/**
 * Limites de saisie et valeurs de référence des formulaires.
 *
 * Centralisées ici plutôt que dispersées dans les schémas de validation : une
 * longueur maximale ou une palette écrite au fil du code devient impossible à
 * retrouver, et diverge inévitablement entre la validation serveur et
 * l'attribut `maxLength` du champ correspondant.
 */

/** Longueurs maximales, alignées sur ce que l'interface peut afficher sans tronquer. */
export const FIELD_LIMITS = {
  name: 120,
  description: 1000,
  address: 500,
  email: 320,
  phone: 40,
  /**
   * Notes médicales délibérément courtes.
   *
   * Ce sont des données de santé concernant des enfants (§7 du blueprint) : la
   * minimisation n'est pas une préférence mais une obligation. Le champ sert à
   * signaler ce qu'un coach doit savoir au bord du bassin — une allergie, un
   * asthme — pas à tenir un dossier médical.
   */
  medicalNotes: 500,
} as const;

/**
 * Âge plausible d'un élève, en années. Sert uniquement à rejeter une date de
 * naissance manifestement erronée — une faute de frappe sur l'année, typiquement.
 */
export const STUDENT_AGE_BOUNDS = { minimum: 0, maximum: 100 } as const;

/**
 * Format d'une couleur de niveau : hexadécimal sur six chiffres, préfixé.
 * Choisi plutôt qu'un nom de couleur pour rester exploitable partout — badges,
 * exports PDF, e-mails.
 */
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Palette proposée pour les niveaux.
 *
 * Simples suggestions : le champ accepte n'importe quelle couleur hexadécimale.
 * Beaucoup d'écoles de natation ont déjà un code couleur établi, qu'il ne
 * s'agit pas de leur imposer. Modifier cette liste ne change rien aux niveaux
 * existants.
 */
export const LEVEL_COLOR_SUGGESTIONS = [
  "#0ea5e9",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#a855f7",
  "#64748b",
] as const;

/** Couleur pré-remplie à la création d'un niveau. */
export const DEFAULT_LEVEL_COLOR: string = LEVEL_COLOR_SUGGESTIONS[0];

/**
 * Pas d'incrément des `sort_order`. Un écart entre deux positions permet
 * d'insérer un niveau entre deux existants sans renuméroter toute la liste.
 */
export const SORT_ORDER_STEP = 10;
