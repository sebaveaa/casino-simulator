import { check, sleep } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";

// Crash load test (PLAN-CRASH §7, letter H): a crowd of players joins the same round, bets, and
// cashes out at takeoff. It proves the engine holds 100 simultaneous cash-outs and that a bet pays
// at most once (a double click returns the same payout). The ledger-balances check is a SQL query
// run after the test; see load/README.md. Not part of `npm test`: it needs the API and the k6 binary.
//
//   k6 run -e API_URL=http://localhost:3000 -e PLAYERS=100 load/crash-load.js

const BASE = (__ENV.API_URL || "http://localhost:3000").replace(/\/+$/, "");
const GAME = __ENV.CRASH_GAME || "dino-crash";
const PLAYERS = Number(__ENV.PLAYERS || 100);
const ROUNDS = Number(__ENV.ROUNDS || 3);
const STAKE = __ENV.STAKE || "1000"; // 10 credits in minor units
const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

/** A bet that was cashed out twice and got two different payouts: a double-pay the ledger must forbid. */
const doublePayout = new Counter("crash_double_payout");
/** Cash-outs the server accepted (paid out). */
const cashouts = new Counter("crash_cashouts");

export const options = {
  scenarios: {
    crash_round: {
      executor: "per-vu-iterations",
      vus: PLAYERS,
      iterations: ROUNDS,
      maxDuration: "6m",
    },
  },
  thresholds: {
    // Expected rejections (a round that crashed at 1.00x, a closed betting window) are handled in the
    // script and never counted as HTTP failures, so the failure rate should stay near zero.
    http_req_failed: ["rate<0.02"],
    checks: ["rate>0.98"],
    crash_double_payout: ["count==0"],
  },
};

function uuid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${__VU}`;
}

function authHeaders(token, idempotencyKey) {
  const headers = { ...JSON_HEADERS, authorization: `Bearer ${token}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

/** Registers every player once and funds the wallet; the tokens are shared with the scenario. */
export function setup() {
  const tokens = [];
  for (let i = 0; i < PLAYERS; i++) {
    const email = `load-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}@test.local`;
    const register = http.post(
      `${BASE}/auth/register`,
      JSON.stringify({ email, password: "load-test-password" }),
      { headers: JSON_HEADERS },
    );
    check(register, { "register ok": (r) => r.status === 200 || r.status === 201 });
    const token = register.json("token");
    const deposit = http.post(`${BASE}/wallet/deposits`, JSON.stringify({ amount: "100000" }), {
      headers: authHeaders(token, uuid()),
    });
    check(deposit, { "deposit ok": (r) => r.status === 200 || r.status === 201 });
    tokens.push(token);
  }
  return { tokens };
}

function currentRound(token) {
  const res = http.get(`${BASE}/games/crash/${GAME}/rounds/current`, {
    headers: authHeaders(token),
  });
  if (res.status !== 200) return null;
  return res.json("round");
}

/** Waits (polling) for the current round to leave the betting window, up to `tries` times. */
function waitForTakeoff(token, roundId, tries) {
  for (let i = 0; i < tries; i++) {
    const round = currentRound(token);
    if (!round || round.id !== roundId) return null; // the round moved on without us
    if (round.status !== "open") return round;
    sleep(0.3);
  }
  return null;
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];

  // Join whatever round is open; if none is, wait briefly and skip this iteration.
  let round = currentRound(token);
  for (let i = 0; i < 20 && round?.status !== "open"; i++) {
    sleep(0.3);
    round = currentRound(token);
  }
  if (round?.status !== "open") return;

  // Bet, with one idempotency key for this (player, round).
  const betKey = `bet-${__VU}-${round.id}`;
  const bet = http.post(
    `${BASE}/games/crash/${GAME}/bets`,
    JSON.stringify({ roundId: round.id, stake: STAKE }),
    { headers: authHeaders(token, betKey) },
  );
  // 201 placed, or 409 if this VU already bet this round, or 400 if the window just closed.
  const betOk = bet.status === 201 || bet.status === 409 || bet.status === 400;
  check(bet, { "bet accepted or cleanly refused": () => betOk });
  if (bet.status !== 201) return;
  const betId = bet.json("betId");

  // Wait for takeoff, then cash out twice: the second must return the same payout (pay once).
  const flying = waitForTakeoff(token, round.id, 20);
  if (!flying) return;

  const url = `${BASE}/games/crash/${GAME}/bets/${betId}/cashout`;
  const first = http.post(url, null, { headers: authHeaders(token) });
  const second = http.post(url, null, { headers: authHeaders(token) });

  // 200 means paid; 400 means the round crashed before this VU cashed out (a valid outcome).
  const firstOk = first.status === 200 || first.status === 400;
  check(first, { "cashout paid or too late": () => firstOk });

  if (first.status === 200) {
    cashouts.add(1);
    // The retry must replay the same payout; a different one would be a double-pay.
    const same = second.status === 200 && second.json("payout") === first.json("payout");
    const refused = second.status === 400; // already settled as a cash-out is also fine
    check(second, { "cashout retry pays once": () => same || refused });
    if (second.status === 200 && second.json("payout") !== first.json("payout")) {
      doublePayout.add(1);
    }
  }
}
