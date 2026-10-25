import {
  CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT,
  CHICKEN_ROAD_HISTORY_MAX_LIMIT,
  type ChickenRoadFinishedGame,
  type ChickenRoadGame,
  type ChickenRoadInProgressGame,
  type SeedPairResponse,
} from "@casino/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, useApi } from "../../api";
import { useApplyBalance, useRefreshBalance } from "../../app/useBalance";
import { betErrorMessage } from "../betErrorMessage";
import { prefersReducedMotion } from "../roulette/motion";

/** What the panel shows: the bet form, a game on the road, or a game that ended. */
export type ChickenRoadView =
  | { kind: "bet" }
  | { kind: "playing"; game: ChickenRoadInProgressGame }
  | { kind: "over"; game: ChickenRoadFinishedGame };

const EXPIRED_REFUNDED = "Tu partida expiró y se devolvió tu apuesta.";
const ALREADY_IN_PROGRESS = "Ya tienes una partida en curso.";
const ALREADY_FINISHED = "Esa partida ya terminó.";

function viewOf(game: ChickenRoadGame): ChickenRoadView {
  return game.status === "in_progress" ? { kind: "playing", game } : { kind: "over", game };
}

/** How long the panel waits after a step, so the road shows the result first. */
export const REVEAL_MS = 450;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isConflict = (error: unknown) => error instanceof ApiError && error.code === "conflict";
const isNetwork = (error: unknown) => error instanceof ApiError && error.code === "network";

/**
 * State and requests of the Cruza la Calle screen. The server decides every result; this hook
 * only sends the request, waits, and shows what came back. While a request is pending every
 * action is refused, and `pending` always clears afterwards, so the screen never stays stuck.
 */
export function useChickenRoad() {
  const api = useApi();
  const applyBalance = useApplyBalance();
  const refreshBalance = useRefreshBalance();

  // The road shows each answer at once; after a step the panel follows `REVEAL_MS` later, so it
  // does not give the result away before the chicken lands.
  const [view, setPanelView] = useState<ChickenRoadView>({ kind: "bet" });
  const [roadView, setRoadView] = useState<ChickenRoadView>({ kind: "bet" });
  const setView = useCallback((next: ChickenRoadView) => {
    setRoadView(next);
    setPanelView(next);
  }, []);
  const [history, setHistory] = useState<ChickenRoadFinishedGame[]>([]);
  const [seedPair, setSeedPair] = useState<SeedPairResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A ref as well as state: two clicks in the same frame both see `busy` before React re-renders.
  const busy = useRef(false);
  // One Idempotency-Key per stake, kept only after a network failure so a retry charges once.
  const pendingKey = useRef<{ stake: string; key: string } | null>(null);

  const loadSeedPair = useCallback(async () => {
    try {
      setSeedPair(await api.getSeedPair());
    } catch {
      // The hash is informative; the game works without it.
    }
  }, [api]);

  /** History for display; `limit` 20 when a resync must find a game in it. */
  const loadHistory = useCallback(
    async (limit = CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT) => {
      const { games } = await api.listChickenRoadHistory({ limit });
      setHistory(games.slice(0, CHICKEN_ROAD_HISTORY_DEFAULT_LIMIT));
      return games;
    },
    [api],
  );

  /** After a game ends: new history, the next nonce, and the balance from the server. */
  const afterGameEnds = useCallback(async () => {
    await Promise.allSettled([loadHistory(), loadSeedPair(), refreshBalance()]);
  }, [loadHistory, loadSeedPair, refreshBalance]);

  // On load: restore a game in progress (the acceptance criterion "restored after a reload").
  useEffect(() => {
    let active = true;
    (async () => {
      const [current] = await Promise.allSettled([
        api.getCurrentChickenRoadGame(),
        loadHistory(),
        loadSeedPair(),
      ]);
      if (!active) return;
      if (current.status === "fulfilled" && current.value.game) {
        setView({ kind: "playing", game: current.value.game });
      } else if (current.status === "rejected") {
        setMessage(betErrorMessage(current.reason));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [api, loadHistory, loadSeedPair, setView]);

  async function run(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    try {
      await action();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /**
   * A step or cash-out answered 409: the server's state wins. In order: a game still in progress
   * is restored at its real lane; a finished one shows its real result; a game that is in neither
   * expired before its first lane and was refunded.
   */
  async function resyncGame(gameId: string) {
    const { game: current } = await api.getCurrentChickenRoadGame();
    if (current) {
      setView({ kind: "playing", game: current });
      return;
    }
    const games = await loadHistory(CHICKEN_ROAD_HISTORY_MAX_LIMIT);
    const finished = games.find((g) => g.gameId === gameId);
    if (finished) {
      setView({ kind: "over", game: finished });
    } else {
      setView({ kind: "bet" });
      setMessage(EXPIRED_REFUNDED);
    }
    await Promise.allSettled([loadSeedPair(), refreshBalance()]);
  }

  /** A start answered 409: either a game is in progress, or this key's game already finished. */
  async function resyncStart() {
    const { game: current } = await api.getCurrentChickenRoadGame();
    if (current) {
      setView({ kind: "playing", game: current });
      setMessage(ALREADY_IN_PROGRESS);
      return;
    }
    setView({ kind: "bet" });
    setMessage(ALREADY_FINISHED);
    await afterGameEnds();
  }

  /** Runs `request`; a 409 resyncs with `onConflict`, anything else shows its message. */
  async function guarded(request: () => Promise<void>, onConflict: () => Promise<void>) {
    try {
      await request();
    } catch (caught) {
      if (!isConflict(caught)) {
        setMessage(betErrorMessage(caught));
        return;
      }
      try {
        await onConflict();
      } catch (again) {
        setMessage(betErrorMessage(again));
      }
    }
  }

  function start(stake: string) {
    return run(() =>
      guarded(async () => {
        if (pendingKey.current?.stake !== stake) {
          pendingKey.current = { stake, key: crypto.randomUUID() };
        }
        const { key } = pendingKey.current;
        try {
          const res = await api.startChickenRoadGame({ stake }, key);
          pendingKey.current = null;
          setView({ kind: "playing", game: res.game });
          applyBalance(res.balance);
          void refreshBalance();
        } catch (caught) {
          if (!isNetwork(caught)) pendingKey.current = null;
          throw caught;
        }
      }, resyncStart),
    );
  }

  function step() {
    if (view.kind !== "playing") return Promise.resolve();
    const { gameId, lanesCrossed } = view.game;
    return run(() =>
      guarded(
        async () => {
          // A retry after a network failure sends the same lane, which the server replays.
          const res = await api.stepChickenRoadGame({ gameId, lane: lanesCrossed + 1 });
          const next = viewOf(res.game);
          setRoadView(next);
          // Buttons stay disabled meanwhile: `run` holds `pending` until this resolves.
          if (!prefersReducedMotion()) await sleep(REVEAL_MS);
          setPanelView(next);
          applyBalance(res.balance);
          if (res.game.status === "in_progress") void refreshBalance();
          else await afterGameEnds();
        },
        () => resyncGame(gameId),
      ),
    );
  }

  function cashOut() {
    if (view.kind !== "playing") return Promise.resolve();
    const { gameId } = view.game;
    return run(() =>
      guarded(
        async () => {
          const res = await api.cashOutChickenRoadGame({ gameId });
          setView(viewOf(res.game));
          applyBalance(res.balance);
          await afterGameEnds();
        },
        () => resyncGame(gameId),
      ),
    );
  }

  function playAgain() {
    if (busy.current) return;
    setMessage(null);
    setView({ kind: "bet" });
  }

  return {
    view,
    roadView,
    history,
    seedPair,
    loading,
    pending,
    message,
    start,
    step,
    cashOut,
    playAgain,
  };
}
