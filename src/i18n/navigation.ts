import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Équivalents localisés des primitives de navigation Next.js : ils ajoutent le
 * préfixe de langue automatiquement. À utiliser partout à la place de
 * `next/link` et `next/navigation`.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
