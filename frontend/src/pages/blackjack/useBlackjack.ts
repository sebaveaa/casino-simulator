import {
  BLACKJACK_HISTORY_DEFAULT_LIMIT,
  BLACKJACK_HISTORY_MAX_LIMIT,
  type BlackjackAction,
  type BlackjackActionResponse,
  type BlackjackHand,
  type BlackjackInProgressHand,
  type BlackjackSettledHand,
  type BlackjackShoe,
  type BlackjackStartResponse,
  type SeedPairResponse,
} from "@casino/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, useApi } from "../../api";
import { newUuid } from "../../api/uuid";
import { useApplyBalance, useRefreshBalance } from "../../app/useBalance";
import { betErrorMessage } from "../betErrorMessage";
import { prefersReducedMotion } from "../roulette/motion";
import { cardsOf, type DealPlan, NO_DEAL, planDeal } from "./deal";
import { roundSummary } from "./format";
import { playResultSound } from "./sound";

/** What the screen shows: the bet form, a hand on the player's turn, or a settled hand. */
export type BlackjackView =
  | { kind: "bet" }
  | { kind: "playing"; hand: BlackjackInProgressHand }
  | { kind: "over"; hand: BlackjackSettledHand };

export const ALREADY_IN_PROGRESS = "Ya tienes una mano en curso.";
export const ALREADY_FINISHED = "Esa mano ya terminó.";
export const HAND_GONE = "No encontramos esa mano. Empieza una nueva.";

export function viewOf(hand: BlackjackHand): BlackjackView {
  return hand.status === "player_turn" ? { kind: "playing", hand } : { kind: "over", hand };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isConflict = (error: unknown) => error instanceof ApiError && error.code === "conflict";
const isNetwork = (error: unknown) => error instanceof ApiError && error.code === "network";

/**
 * State and requests of the Blackjack screen. The server deals every card and settles every hand;
 * this hook only sends the request and shows what came back. While a request is pending, or its
 * cards are still landing, every action is refused, and `pending` always clears afterwards, so the
 * screen never stays stuck. The balance and the history follow once the cards have landed, so
 * neither gives the result away first; the result's sound plays as the last card lands.
 */
export function useBlackjack() {
  const api = useApi();
  const applyBalance = useApplyBalance();
  const refreshBalance = useRefreshBalance();

  const [view, setViewState] = useState<BlackjackView>({ kind: "bet" });
  const [deal, setDeal] = useState<DealPlan>(NO_DEAL);
  // The view on the felt right now, read when the next one arrives to know which cards are new.
  const shown = useRef<BlackjackView>({ kind: "bet" });

  /** Shows `next` and plans the cards that land; returns how long they take. */
  const setView = useCallback((next: BlackjackView) => {
    const reduced = prefersReducedMotion();
    const plan = planDeal(
      cardsOf(shown.current),
      cardsOf(next),
      reduced ? 0 : undefined,
      reduced ? 0 : undefined,
    );
    shown.current = next;
    setDeal(plan);
    setViewState(next);
    return plan.durationMs;
  }, []);
  const [history, setHistory] = useState<BlackjackSettledHand[]>([]);
  const [seedPair, setSeedPair] = useState<SeedPairResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // How much of the player's shoe is dealt (#66); `null` before the first hand of a new shoe.
  const [shoe, setShoe] = useState<BlackjackShoe | null>(null);
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

  /** History for display; `limit` 20 when a resync must find a hand in it. */
  const loadHistory = useCallback(
    async (limit = BLACKJACK_HISTORY_DEFAULT_LIMIT) => {
      const { hands } = await api.listBlackjackHistory({ limit });
      setHistory(hands.slice(0, BLACKJACK_HISTORY_DEFAULT_LIMIT));
      return hands;
    },
    [api],
  );

  /** After a hand settles: new history, the next nonce, and the balance from the server. */
  const afterHandEnds = useCallback(async () => {
    await Promise.allSettled([loadHistory(), loadSeedPair(), refreshBalance()]);
  }, [loadHistory, loadSeedPair, refreshBalance]);

  // On load: restore a hand in progress, so a reload never loses it.
  useEffect(() => {
    let active = true;
    (async () => {
      const [current] = await Promise.allSettled([
        api.getCurrentBlackjackHand(),
        loadHistory(),
        loadSeedPair(),
      ]);
      if (!active) return;
      if (current.status === "fulfilled") setShoe(current.value.shoe);
      if (current.status === "fulfilled" && current.value.hand) {
        setView({ kind: "playing", hand: current.value.hand });
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

  /**
   * An action answered 409: the server's state wins. A hand still in progress is shown as it
   * really is (for example after another tab played it); a settled one shows its real result.
   */
  async function resyncHand(handId: string) {
    const { hand: current, shoe: currentShoe } = await api.getCurrentBlackjackHand();
    setShoe(currentShoe);
    if (current) {
      setView({ kind: "playing", hand: current });
      return;
    }
    const hands = await loadHistory(BLACKJACK_HISTORY_MAX_LIMIT);
    const settled = hands.find((h) => h.handId === handId);
    if (settled) {
      setView({ kind: "over", hand: settled });
    } else {
      setView({ kind: "bet" });
      setMessage(HAND_GONE);
    }
    await Promise.allSettled([loadSeedPair(), refreshBalance()]);
  }

  /** A start answered 409: a hand is already in progress, or this key's hand already finished. */
  async function resyncStart() {
    const { hand: current, shoe: currentShoe } = await api.getCurrentBlackjackHand();
    setShoe(currentShoe);
    if (current) {
      setView({ kind: "playing", hand: current });
      setMessage(ALREADY_IN_PROGRESS);
      return;
    }
    setView({ kind: "bet" });
    setMessage(ALREADY_FINISHED);
    await afterHandEnds();
  }

  /**
   * Shows the hand the server answered once its cards have landed, then the balance. A settled
   * hand sounds its result and reloads the history and the next nonce.
   */
  async function land(res: BlackjackStartResponse | BlackjackActionResponse) {
    await sleep(setView(viewOf(res.hand)));
    // The shoe sinks once the cards have landed, like the balance.
    setShoe(res.shoe);
    applyBalance(res.balance);
    if (res.hand.status === "settled") {
      playResultSound(roundSummary(res.hand).tone);
      await afterHandEnds();
    } else {
      void refreshBalance();
    }
  }

  function start(stake: string) {
    return run(() =>
      guarded(async () => {
        if (pendingKey.current?.stake !== stake) {
          pendingKey.current = { stake, key: newUuid() };
        }
        const { key } = pendingKey.current;
        try {
          const res = await api.startBlackjackHand({ stake }, key);
          pendingKey.current = null;
          // A natural settles at once.
          await land(res);
        } catch (caught) {
          if (!isNetwork(caught)) pendingKey.current = null;
          throw caught;
        }
      }, resyncStart),
    );
  }

  function act(action: BlackjackAction) {
    if (view.kind !== "playing") return Promise.resolve();
    const { handId, actionCount } = view.hand;
    return run(() =>
      guarded(
        async () => {
          // A retry after a network failure sends the same index, which the server replays.
          await land(await api.playBlackjackAction({ handId, action, index: actionCount }));
        },
        () => resyncHand(handId),
      ),
    );
  }

  /** The shuffle played: the next hand opens a new shoe, so the pile shows it full. */
  const shoeShuffled = useCallback(() => setShoe(null), []);

  /** Back to the bet form, to change the stake. */
  function changeBet() {
    if (busy.current) return;
    setMessage(null);
    setView({ kind: "bet" });
  }

  /**
   * "Repetir apuesta": clears the felt and deals the next hand at once with `stake`. If the start
   * fails, the bet form stays with the reason.
   */
  function repeat(stake: string) {
    if (busy.current) return Promise.resolve();
    setView({ kind: "bet" });
    return start(stake);
  }

  return {
    view,
    deal,
    history,
    seedPair,
    loading,
    pending,
    message,
    start,
    act,
    changeBet,
    repeat,
    shoe,
    shoeShuffled,
  };
}
