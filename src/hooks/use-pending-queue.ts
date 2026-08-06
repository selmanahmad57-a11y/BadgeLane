"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * File de « taps durables » — un geste fait au bord du bassin ne se perd pas.
 *
 * ── Ce que la file garantit, et ce qu'elle ne garantit pas ───────────────────
 *
 * Chaque geste est appliqué immédiatement à l'écran, puis mis en file locale.
 * La file survit à une coupure réseau **et à un rechargement de page**, et se
 * vide seule au retour du réseau.
 *
 * Elle ne rend pas l'application utilisable hors ligne à froid : charger de
 * nouvelles données demande toujours une connexion.
 *
 * ── Ce qui rend le rejeu sûr ─────────────────────────────────────────────────
 *
 * Rien, dans ce fichier. La sûreté vient de la **base** : chaque écriture visée
 * porte une contrainte d'unicité qui transforme l'envoi en `upsert`. Rejouer
 * produit alors le même état, jamais un doublon.
 *
 * C'est pourquoi la contrainte se pose toujours avant d'écrire une file, et
 * jamais l'inverse : une file qu'on ne peut pas retenter ne sert à rien.
 *
 * ── Pourquoi la file est clée ────────────────────────────────────────────────
 *
 * `dedupeKey` identifie **ce qui est décrit**, pas le geste. Un coach qui tape
 * présent, se ravise en absent, puis revient à présent produit UNE entrée en
 * attente, pas trois : on met en file un état, pas un historique de clics.
 *
 * ── Pourquoi la clé de stockage est propre à chaque membre ───────────────────
 *
 * Sur une tablette partagée, les gestes d'un coach ne doivent jamais partir
 * sous la session d'un autre — le serveur enregistre toujours sa propre
 * identité, donc une file commune produirait de fausses attributions.
 */

export type PendingQueueOptions<TItem> = {
  /** Propre au membre **et** au type d'écriture. Voir `pendingQueueKey`. */
  storageKey: string;
  /** Identifie ce que l'entrée décrit : `séance:élève`, `élève:compétence`… */
  dedupeKey: (item: TItem) => string;
  /** Action serveur, idempotente par construction. */
  submit: (items: TItem[]) => Promise<{ ok: boolean }>;
  retryDelayMs: number;
};

export type PendingQueue<TItem> = {
  /** Entrées non encore confirmées, indexées par `dedupeKey`. */
  pending: Map<string, TItem>;
  pendingCount: number;
  online: boolean;
  enqueue: (item: TItem) => void;
};

export function usePendingQueue<TItem>({
  storageKey,
  dedupeKey,
  submit,
  retryDelayMs,
}: PendingQueueOptions<TItem>): PendingQueue<TItem> {
  const [items, setItems] = useState<TItem[]>([]);
  const [online, setOnline] = useState(true);

  /**
   * Miroir des entrées, lu par `flush`.
   *
   * Sans lui, `flush` capturerait l'état au moment de sa création et un geste
   * tout juste ajouté attendrait le prochain cycle avant de partir. La
   * référence est mise à jour au même instant que l'état — jamais après.
   */
  const itemsRef = useRef<TItem[]>([]);
  const flushing = useRef(false);

  const applyItems = useCallback((next: TItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  /**
   * Reprise après rechargement.
   *
   * React 19 déconseille de poser un état depuis un effet. C'est ici le seul
   * endroit possible : `localStorage` n'existe pas pendant le rendu serveur, et
   * le lire dans l'initialiseur de `useState` produirait une divergence
   * d'hydratation — le défaut rencontré en Semaine 4 avec les noms de langues.
   * Le coût est d'un rendu supplémentaire, une seule fois.
   */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;

      // eslint-disable-next-line react-hooks/set-state-in-effect -- voir ci-dessus
      applyItems(JSON.parse(stored) as TItem[]);
    } catch {
      /** Une file illisible est écartée : mieux vaut repartir que planter. */
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey, applyItems]);

  useEffect(() => {
    try {
      if (items.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      /** Stockage plein ou refusé : la file reste en mémoire, sans bloquer. */
    }
  }, [items, storageKey]);

  const flush = useCallback(async () => {
    const snapshot = itemsRef.current;

    if (flushing.current || snapshot.length === 0) return;
    flushing.current = true;

    try {
      const result = await submit(snapshot);

      if (result.ok) {
        /**
         * Comparaison par référence : une entrée remplacée pendant l'envoi est
         * un objet neuf, elle reste donc en file. Ne retirer que ce qui a
         * effectivement été envoyé évite de perdre un geste survenu entre-temps.
         */
        applyItems(
          itemsRef.current.filter((item) => !snapshot.includes(item)),
        );
        setOnline(true);
      }
    } catch {
      /** Réseau absent ou serveur injoignable : on garde et on retentera. */
      setOnline(false);
    } finally {
      flushing.current = false;
    }
  }, [submit, applyItems]);

  useEffect(() => {
    const attempt = () => void flush();

    const onOnline = () => {
      setOnline(true);
      attempt();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    /**
     * L'intervalle couvre la file restaurée après rechargement et les échecs à
     * retenter. Les gestes en cours de saisie, eux, partent immédiatement
     * depuis `enqueue` — pas besoin d'une tentative synchrone ici.
     */
    const timer = window.setInterval(attempt, retryDelayMs);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, [flush, retryDelayMs]);

  const enqueue = useCallback(
    (item: TItem) => {
      const key = dedupeKey(item);

      applyItems([
        /** On remplace l'état en attente pour cette clé, on n'empile pas. */
        ...itemsRef.current.filter((entry) => dedupeKey(entry) !== key),
        item,
      ]);

      /** `flush` lit la référence, déjà à jour : le geste part maintenant. */
      void flush();
    },
    [dedupeKey, applyItems, flush],
  );

  const pending = useMemo(() => {
    const map = new Map<string, TItem>();
    for (const item of items) map.set(dedupeKey(item), item);
    return map;
  }, [items, dedupeKey]);

  return { pending, pendingCount: pending.size, online, enqueue };
}
