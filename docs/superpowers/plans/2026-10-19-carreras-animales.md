# Carreras de animales: plan de implementación

> **Para agentes:** SUB-HABILIDAD REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos usan casillas `- [ ]`.

**Objetivo:** juego de carreras de animales de punta a punta: worker con ciclo de rondas, apuesta a ganador, SSE y carrera animada, con liquidación idempotente.

**Arquitectura:** el worker mueve la ronda por `open`, `closed`, `resolved`, `settled` con un bucle de sondeo y bloqueo de fila. La API recibe apuestas por REST dentro de una transacción de PostgreSQL con Wallet, y reenvía por SSE los eventos que el worker publica en Redis. El frontend anima un orden de llegada ya decidido por el servidor.

**Tecnologías:** TypeScript, Fastify 5, Kysely, ioredis, Zod, React 19, PixiJS 8, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-carreras-animales-design.md`. README §2.5, §3, §4.3, §5.2, §6.

## Restricciones globales

- Dinero entero en `bigint`, texto en la API y en jsonb. Solo el servicio Wallet mueve dinero (`AGENTS.md`).
- Pago `stake * 9n / 2n` (4,5x, apuesta incluida, división entera hacia abajo). 5 animales, índices `0..4`, probabilidad 1/5.
- Una apuesta por jugador por ronda, con `Idempotency-Key`. Solo apuesta a ganador.
- Resultado `{ winner, order }`, `order` permutación de `[0,1,2,3,4]`, `winner = order[0]`, derivada de `HMAC-SHA256(server_seed, round_id)`.
- Estados de ronda del esquema: `open`, `closed`, `resolved`, `settled`. Estados de apuesta: `pending`, `settled`.
- `server_seed` nunca sale en un endpoint ni evento mientras la ronda esté en `open` o `closed`; nunca `select *` sobre `game_rounds` en rutas.
- Ventana ~30 s, carrera ~10 s, liquidar tras la animación. El SSE usa `fetch` con `Authorization: Bearer`, no `EventSource`.
- Texto de interfaz en español; código, tests y commits en inglés. Commits convencionales que terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Antes de codificar: issue de GitHub, rama `feat/<issue>-races` desde `main` y `odd/tasks/<issue>-races.md` (`AGENTS.md`). PRs apilados de ~400 líneas, un PR por bloque (A a E).
- Pruebas de integración con `TEST_DATABASE_URL`; `npm run lint && npm run typecheck && npm test` antes de cada push.

## Enfoque de revisión

Entradas o fallos que el diseño implica y ninguna tarea exige por sí sola; cada uno tiene su prueba en la tarea indicada.

1. Una apuesta en vuelo cuando el worker cierra la ronda no queda sin liquidar (T5, T7).
2. Doble clic con dos claves distintas: se cobra una sola vez y la segunda recibe `409` (T5).
3. El worker cae a mitad de la liquidación y reinicia: nadie cobra dos veces (T7).
4. Apuesta mínima impar y apuesta máxima: `stake 1` gana `4`; el pago nunca supera `MAX_MONEY` (T2, T5).
5. Jugador que entra con la ronda cerrada o sin ronda activa, y reconexión del flujo: ve el estado por REST y no se rompe (T6, T10).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `shared/src/games/races.ts` | reglas puras: animales, validación, `resolveRace`, `racePayout` |
| `shared/src/api/races.ts` | contratos Zod de apuesta, ronda actual y eventos |
| `shared/src/rng.ts` | `computeRoundOutcome` |
| `backend/db/migrations/0003_race_rounds.ts` | columnas de resultado e índice único de apuesta por ronda |
| `backend/games/races/rounds.ts` | consultas de rondas (actual, por id, proyección sin semilla) |
| `backend/games/races/place-bet.ts` | apuesta transaccional e idempotente |
| `backend/games/races/routes.ts` | `POST` apuesta, `GET` actual, `GET` ronda |
| `backend/realtime/race-events.ts` | tipo del bus de eventos, implementación en memoria |
| `backend/realtime/redis-race-events.ts` | bus sobre Redis pub/sub |
| `backend/realtime/stream-routes.ts` | `GET /races/stream` (SSE autenticado) |
| `backend/worker/race-cycle.ts` | `advanceRaces`: abrir, cerrar, correr, liquidar |
| `frontend/src/pages/RacesPage.tsx` y `frontend/src/pages/races/*` | pantalla, pista animada, cuenta regresiva |

---

## Bloque A: contratos compartidos (PR 1)

### Task 0: Issue, rama y archivo de tareas

**Files:** Create: `odd/tasks/<issue>-races.md`

- [ ] **Step 1:** crear el issue de GitHub "Carreras de animales" con los criterios de aceptación del spec §3 y §5; anotar su número.
- [ ] **Step 2:** `git switch -c feat/<issue>-races` desde `main`.
- [ ] **Step 3:** crear `odd/tasks/<issue>-races.md` con el formato de `odd/tasks/38-roulette-multi-bet.md`: enlace al issue, objetivo, casillas `T1`..`T12`, criterios y comprobaciones. Commit `docs(races): add task file`.

### Task 1: Resultado de ronda en `shared`

**Files:**
- Modify: `shared/src/rng.ts`, `shared/src/index.ts`
- Create: `shared/src/games/races.ts`
- Test: `shared/src/rng.test.ts`, `shared/src/games/races.test.ts`

**Interfaces:**
- Produces: `computeRoundOutcome(serverSeed: string, roundId: string): Promise<Outcome>`; `ANIMAL_COUNT = 5`; `RaceResult = { winner: number; order: number[] }`; `raceResultSchema`; `resolveRace(rng: Rng): RaceResult`.

- [ ] **Step 1: Escribir las pruebas que fallan**
  - `rng.test.ts`: `computeRoundOutcome("seed", "round")` coincide con HMAC-SHA256 de clave `seed` y mensaje `round` calculado con `node:crypto` en la prueba, y son 64 hex.
  - `races.test.ts`: con `createRng` de un outcome fijo, `resolveRace` devuelve `order` con exactamente `[0,1,2,3,4]` al ordenar, `winner === order[0]`, y es determinista (dos llamadas iguales). Fija un outcome conocido y comprueba el `order` esperado literal.
  - Distribución: con `rng` falso que recorre todos los enteros de `int`, cada animal es ganador en `ANIMAL_COUNT` de los `5!` casos (sin sesgo).
- [ ] **Step 2: Ejecutar y ver el fallo:** `npx vitest run shared/src/games/races.test.ts shared/src/rng.test.ts`; esperado FAIL por exportaciones inexistentes.
- [ ] **Step 3: Implementar** `computeRoundOutcome` reutilizando el HMAC interno de `rng.ts`; `resolveRace` con barajado Fisher-Yates que llama `rng.int(i + 1)` de `ANIMAL_COUNT - 1` hasta `1`; exportar desde `shared/src/index.ts`.
- [ ] **Step 4: Ejecutar y ver que pasa**, más `npm run typecheck -w shared`.
- [ ] **Step 5: Commit** `feat(races): derive the round outcome and the arrival order`.

### Task 2: Reglas de la apuesta y pago

**Files:** Modify: `shared/src/games/races.ts`; Test: `shared/src/games/races.test.ts`

**Interfaces:**
- Consumes: `Game`, `Wager` de `shared/src/games/game.ts`, `MAX_MONEY`.
- Produces: `RaceBet = Wager & { animal: number }`; `races: Game<RaceBet, RaceResult>` con `id: "races"`; `racePayout(stake: Money): Money`.

- [ ] **Step 1: Pruebas que fallan:** `racePayout(1n) === 4n`, `racePayout(100n) === 450n`, `racePayout(3n) === 13n`; `validateBet` falla con `stake 0n`, con `animal 5`, con `animal -1`, con `animal 1.5`, y con un `stake` cuyo pago supera `MAX_MONEY`; pasa con `stake 1n, animal 0`; `payout(bet, result)` es `racePayout(stake)` si `bet.animal === result.winner` y `0n` si no.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** `races` y `racePayout` con `stake * 9n / 2n`.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit** `feat(races): add the bet rules and the 4.5x payout`.

### Task 3: Contratos de API y rutas

**Files:**
- Create: `shared/src/api/races.ts`
- Modify: `shared/src/api/paths.ts`, `shared/src/api/index.ts`
- Test: `shared/src/api/races.test.ts`

**Interfaces:**
- Produces, todo con Zod:
  - `raceBetRequestSchema = { roundId: uuid, animal: int 0..4, stake: positiveAmount }`.
  - `raceBetResponseSchema = { betId, roundId, animal, stake, balance }`.
  - `raceRoundSchema = { id, status: RoundStatus, opensAt, closesAt, serverSeedHash, result?: RaceResult, serverSeed?: string, settlesAt?: ISO string }`. `result` y `serverSeed` solo existen con estado `resolved` o `settled`.
  - `currentRaceResponseSchema = { round: RaceRound | null, myBet: { animal, stake, payout: Amount | null } | null, now: ISO string }`.
  - `raceEventSchema` unión discriminada por `type`: `opened { round }`, `closed { roundId }`, `result { roundId, result, serverSeed }`, `settled { roundId }`.
  - `apiPaths.raceBets = "/games/races/bets"`, `raceCurrent = "/races/current"`, `raceRound = "/races/rounds/:roundId"`, `raceStream = "/races/stream"`.

- [ ] **Step 1: Pruebas que fallan:** rechazar `animal: 5`, `stake: "0"`, `roundId` que no es uuid; aceptar una ronda `open` sin `result`; rechazar una ronda `open` con `serverSeed` presente (refinamiento); validar un evento de cada `type`.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** los esquemas siguiendo el estilo de `shared/src/api/roulette.ts`; el refinamiento de `raceRoundSchema` exige `serverSeed` y `result` ausentes en `open` y `closed`.
- [ ] **Step 4: Ejecutar y ver que pasa**, más `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(races): add the API contracts and paths`. Abrir PR 1.

---

## Bloque B: base de datos, apuesta y consulta (PR 2)

### Task 4: Migración y tipos

**Files:**
- Create: `backend/db/migrations/0003_race_rounds.ts`
- Modify: `backend/db/migrations/index.ts`, `backend/db/schema.ts`
- Test: `backend/db/migrations/index.test.ts`, integración de PostgreSQL

**Interfaces:**
- Produces: `game_rounds.result jsonb null`, `game_rounds.resolved_at timestamptz null`, `game_rounds.settled_at timestamptz null`; índice único `bets_round_user_key` sobre `bets (round_id, user_id) where round_id is not null`; `GameRoundsTable` con los tres campos nuevos.

- [ ] **Step 1: Prueba que falla:** la prueba de migraciones espera `0003_race_rounds` registrada; una prueba de integración inserta dos apuestas del mismo usuario y ronda y espera violación de unicidad, e inserta una apuesta de ruleta sin `round_id` sin conflicto.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** `up`/`down`, registrarla en `migrations/index.ts` y actualizar `schema.ts`.
- [ ] **Step 4: Ejecutar** `npm run migrate` y las pruebas; deben pasar.
- [ ] **Step 5: Commit** `feat(races): add round result columns and the one-bet-per-round index`.

### Task 5: Apuesta idempotente

**Files:**
- Create: `backend/games/races/place-bet.ts`
- Test: `backend/games/races/place-bet.integration.test.ts`
- Modify: `backend/platform/config.ts`, `backend/platform/config.test.ts`, `.env.example`, `README.md` §13

**Interfaces:**
- Consumes: `WalletService` (`lockBalance`, `findTransaction`, `transfer`, `getBalance`), `scopedKey`, `races`, `racePayout`.
- Produces: `placeRaceBet(trx: Db, deps: { wallet: WalletService }, input: { userId: string; idempotencyKey: string; roundId: string; animal: number; stake: Money; limits: { min: Money; max: Money } }): Promise<RaceBetResponse>`.
- Config nueva: `RACE_BETTING_WINDOW_SECONDS` (30), `RACE_DURATION_SECONDS` (10), `RACE_MIN_STAKE` (1), `RACE_MAX_STAKE` (1000), en `Config` como `raceWindowMs`, `raceDurationMs`, `raceMinStake: bigint`, `raceMaxStake: bigint`.

- [ ] **Step 1: Pruebas que fallan** (integración con base real):
  - apuesta válida: crea fila `pending` con `round_id`, sin `seed_pair_id` ni `nonce`; el saldo baja `stake` y la casa sube `stake`.
  - misma clave dos veces: una sola transacción en el ledger, misma respuesta.
  - misma clave con otro animal o monto: `409 conflict`.
  - dos claves distintas, misma ronda: la segunda da `409 conflict` y el saldo se descontó una vez.
  - ronda `closed`, o con `closes_at` en el pasado aunque `status` siga `open`: error `invalid_request`; saldo intacto.
  - `stake` por debajo de `min` o por encima de `max`: `invalid_request`. Saldo insuficiente: `InsufficientFundsError`.
  - concurrencia: una apuesta que espera `FOR SHARE` mientras otra transacción bloquea la ronda con `FOR UPDATE` y la cierra; al liberarse, la apuesta se rechaza y no queda fila.
  - config: valores por defecto y rechazo de `RACE_MIN_STAKE` mayor que `RACE_MAX_STAKE`.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar.** Orden: `wallet.lockBalance`; buscar transacción por `scopedKey("race-bet", userId, idempotencyKey)` y, si existe, reproducir comparando animal y monto de la fila guardada; `select` de `game_rounds` por id con `.forShare()`; exigir `status = 'open'` y `clock_timestamp() < closes_at`; validar con `races.validateBet` y los límites; insertar la apuesta `pending` con `selection = JSON.stringify({ animal })`; `wallet.transfer` de jugador a `house` tipo `bet`. Una violación del índice `bets_round_user_key` se traduce a `AppError("conflict", ...)`. Añadir las variables al esquema de `config.ts`, a `.env.example` y a la tabla del README §13.
- [ ] **Step 4: Ejecutar con `TEST_DATABASE_URL`**; deben pasar.
- [ ] **Step 5: Commit** `feat(races): place an idempotent bet in an open round`.

### Task 6: Consulta de rondas y rutas

**Files:**
- Create: `backend/games/races/rounds.ts`, `backend/games/races/routes.ts`
- Modify: `backend/platform/routes.ts`
- Test: `backend/games/races/routes.test.ts`, `backend/games/races/rounds.integration.test.ts`

**Interfaces:**
- Consumes: `placeRaceBet`, `requireAuth`, `parseWith`, `readIdempotencyKey`, `apiPaths`.
- Produces: `getCurrentRound(db: Db): Promise<RaceRound | null>` (la ronda no `settled` más reciente, o la última `settled` si no hay otra y su liquidación fue hace menos de `RACE_DURATION`; `null` si no hay ninguna); `getRound(db: Db, roundId: string): Promise<RaceRound | undefined>`; `toRaceRound(row): RaceRound`, que solo incluye `serverSeed` y `result` si el estado es `resolved` o `settled`; `racesRoutes: ModuleRoutes`.
- `RouteDeps` recibe `raceLimits` desde la configuración (extender `RouteDeps` y `buildApp` con `config`).

- [ ] **Step 1: Pruebas que fallan:**
  - `POST raceBets` sin token da `401`; sin `Idempotency-Key` da `400`; apuesta válida da `201` con el cuerpo de `raceBetResponseSchema`; reintento da `201` idéntico.
  - `GET raceCurrent` con ronda `open` devuelve `round.serverSeed === undefined` y `result === undefined`; con ronda `resolved` los incluye; sin rondas devuelve `round: null`; `myBet` aparece para quien apostó y es `null` para otro jugador; `now` es una fecha ISO.
  - `GET raceRound` de una ronda `open` no filtra `serverSeed` aunque se pida por id; id inexistente da `404`.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** con selección explícita de columnas (`opens_at`, `closes_at`, `server_seed_hash`, `status`, y `server_seed`/`result` solo para el mapeo condicional); registrar `racesRoutes` en `moduleRoutes`.
- [ ] **Step 4: Ejecutar y ver que pasa**, más `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(races): add the bet, current round and round endpoints`. Abrir PR 2.

---

## Bloque C: worker (PR 3)

### Task 7: Ciclo de rondas y liquidación

**Files:**
- Create: `backend/worker/race-cycle.ts`
- Modify: `backend/worker/main.ts`, `backend/platform/services.ts`
- Test: `backend/worker/race-cycle.integration.test.ts`

**Interfaces:**
- Consumes: `WalletService`, `RaceEventBus` (T8; en esta tarea se usa un doble de prueba), `computeRoundOutcome`, `createRng`, `resolveRace`, `hashServerSeed`, `racePayout`, `scopedKey`.
- Produces: `advanceRaces(db: Db, deps: { wallet: WalletService; events: RaceEventBus; config: Pick<Config, "raceWindowMs" | "raceDurationMs"> }, now?: () => Date): Promise<void>` ejecuta un paso y publica los eventos después del commit; `startWorker` llama a `advanceRaces` cada 1000 ms y detiene el bucle en `stop`.

- [ ] **Step 1: Pruebas que fallan** (integración, reloj inyectable):
  - sin rondas: abre una con `status open`, `closes_at = opens_at + window`, `server_seed_hash === sha256(server_seed)`; publica `opened` sin `serverSeed`.
  - ronda `open` antes de `closes_at`: no cambia. Pasado `closes_at`: pasa a `closed` y publica `closed`.
  - ronda `closed`: pasa a `resolved`, guarda `result` igual a `resolveRace(createRng(await computeRoundOutcome(seed, id)))`, `resolved_at`, y publica `result` con `serverSeed`.
  - ronda `resolved` antes de `resolved_at + duration`: no liquida. Después: acredita `racePayout(stake)` solo a las apuestas ganadoras, marca todas `settled` con `payout` (0 a las perdedoras, sin transferencia), pasa la ronda a `settled`, publica `settled`.
  - la liquidación en dos pasos seguidos y reiniciada en medio (lotes de 2 con 5 apuestas y una llamada interrumpida): el saldo de cada ganador sube una sola vez; la suma del ledger es cero.
  - una apuesta en vuelo con `FOR SHARE` retrasa el cierre hasta que confirma o se revierte, y queda liquidada.
  - nunca hay más de una ronda no `settled`; no abre otra mientras la anterior no esté `settled`.
  - reinicio con ronda `open` vencida: se cierra y se corre; con ronda `resolved` sin liquidar: se liquida antes de abrir otra.
  - dos llamadas concurrentes a `advanceRaces` sobre la misma ronda no repiten transición ni evento (bloqueo `FOR UPDATE SKIP LOCKED`).
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** cada transición en su propia transacción: seleccionar la ronda no `settled` con `.forUpdate().skipLocked()`, decidir la transición por estado y reloj de la base (`clock_timestamp()`), aplicarla, y devolver eventos para publicar tras `COMMIT`. Liquidación en lotes de 100 apuestas `pending` con `.forUpdate().skipLocked()`, cada pago con clave `scopedKey("race-payout", userId, betId)`; la ronda pasa a `settled` cuando no quedan apuestas `pending`.
- [ ] **Step 4: Ejecutar con `TEST_DATABASE_URL`**; deben pasar. Además `docker compose up -d --build`: con la pila arriba, `psql` muestra rondas avanzando de `open` a `settled`.
- [ ] **Step 5: Commit** `feat(races): run the round lifecycle and settle bets in the worker`. Abrir PR 3.

---

## Bloque D: tiempo real (PR 4)

### Task 8: Bus de eventos sobre Redis

**Files:**
- Create: `backend/realtime/race-events.ts`, `backend/realtime/redis-race-events.ts`
- Modify: `backend/platform/services.ts`, `backend/main.ts`, `backend/worker/main.ts`
- Test: `backend/realtime/race-events.test.ts`, `backend/realtime/redis-race-events.integration.test.ts`

**Interfaces:**
- Produces: `RaceEventBus = { publish(event: RaceEvent): Promise<void>; subscribe(listener: (event: RaceEvent) => void): () => void }`; `createMemoryRaceEventBus(): RaceEventBus` (para tests y como stub); `createRedisRaceEventBus(publisher: Redis, subscriber: Redis): RaceEventBus` en el canal `races` (decisión del plan: un solo canal, hay una ronda activa a la vez); `Services.raceEvents: RaceEventBus` con el bus en memoria en `stubServices`.

- [ ] **Step 1: Pruebas que fallan:** el bus en memoria entrega a todos los suscriptores y deja de entregar tras desuscribir; el bus de Redis (con Redis real) entrega un evento publicado por un bus a otro; un mensaje malformado se descarta sin lanzar; cada `RaceEvent` pasa por `raceEventSchema` al recibirse.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar.** `subscribe` en Redis usa una conexión duplicada solo para suscripción; si `publish` falla por Redis caído, el worker no abre rondas nuevas en ese tick pero sí liquida (spec: caída de Redis).
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit** `feat(realtime): add the race event bus over Redis pub/sub`.

### Task 9: Flujo SSE autenticado

**Files:**
- Create: `backend/realtime/stream-routes.ts`
- Modify: `backend/platform/routes.ts`
- Test: `backend/realtime/stream-routes.test.ts`

**Interfaces:**
- Consumes: `RaceEventBus`, `requireAuth`, `apiPaths.raceStream`.
- Produces: `streamRoutes: ModuleRoutes`; `GET /races/stream` responde `text/event-stream`, un `data:` por evento con el JSON de `RaceEvent`, un comentario `: ping` cada 15 s; máximo 3 conexiones por usuario (la cuarta recibe `429`).

- [ ] **Step 1: Pruebas que fallan:** sin token `401`; con token recibe el evento publicado en el bus como `data: {...}\n\n`; al cerrar el cliente se libera su cupo y se desuscribe; la cuarta conexión del mismo usuario da `429`; el cuerpo de un evento `opened` no contiene `serverSeed`.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** con `reply.raw` y las cabeceras `cache-control: no-cache` y `connection: keep-alive`; contador de conexiones por usuario en memoria.
- [ ] **Step 4: Ejecutar y ver que pasa.** Prueba manual: `curl -N -H "authorization: Bearer <token>" http://localhost:3000/races/stream` con la pila arriba muestra los eventos de cada ronda.
- [ ] **Step 5: Commit** `feat(realtime): stream race events over authenticated SSE`. Abrir PR 4.

---

## Bloque E: frontend (PR 5)

### Task 10: Cliente de API y flujo en vivo

**Files:**
- Modify: `frontend/src/api/client.ts`, `frontend/src/api/http.ts`, `frontend/src/api/mock.ts`
- Test: `frontend/src/api/http.test.ts`, `frontend/src/api/mock.test.ts`

**Interfaces:**
- Produces, en `ApiClient`: `getCurrentRace(): Promise<CurrentRaceResponse>`; `placeRaceBet(body: RaceBetRequest, idempotencyKey: string): Promise<RaceBetResponse>`; `watchRaces(onEvent: (event: RaceEvent) => void, onStatus?: (status: "connected" | "reconnecting") => void): () => void`, que devuelve la función para cerrar el flujo.

- [ ] **Step 1: Pruebas que fallan:**
  - HTTP: `getCurrentRace` y `placeRaceBet` validan con los esquemas compartidos; `watchRaces` lee un stream de `fetch` con `Authorization: Bearer`, analiza varios eventos entregados en trozos partidos y llama `onEvent` una vez por evento; si el stream se corta, reintenta con espera creciente y vuelve a pedir el estado actual antes de seguir; cerrar detiene los reintentos; un `401` llama `onUnauthorized`.
  - Mock: simula el ciclo con temporizadores inyectables (ventana, carrera), genera un resultado determinista con `resolveRace`, y acredita un premio al saldo simulado al liquidar.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** ambos clientes manteniéndolos al día entre sí.
- [ ] **Step 4: Ejecutar y ver que pasa**, más `npm run typecheck -w frontend`.
- [ ] **Step 5: Commit** `feat(races): add the races calls and live stream to the API clients`.

### Task 11: Pista animada y ayudantes puros

**Files:**
- Create: `frontend/src/pages/races/trackMotion.ts`, `frontend/src/pages/races/RaceTrack.tsx`, `frontend/src/pages/races/animals.ts`
- Test: `frontend/src/pages/races/trackMotion.test.ts`

**Interfaces:**
- Produces: `positionsAt(order: number[], progress: number): number[]` devuelve, por animal, avance de `0` a `1`; en `progress >= 1` cada animal está en su meta y el de `order[0]` llegó primero; `animals: { id: number; name: string }[]` con 5 entradas en español; `RaceTrack` recibe `{ order: number[] | null; startedAtMs: number | null; durationMs: number }` y dibuja con PixiJS 8.

- [ ] **Step 1: Pruebas que fallan:** en `progress 0` todos en `0`; en `progress 1` todos en `1` y `order[0]` es el primero en alcanzar `1` en cualquier `progress` intermedio ≥ el de los demás; los avances nunca decrecen al subir `progress`; `progress` fuera de `[0,1]` se limita.
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** `positionsAt` puro; `RaceTrack` lo usa en el ciclo de dibujo, respeta `prefers-reduced-motion` mostrando el resultado final sin animar y no calcula resultados.
- [ ] **Step 4: Ejecutar y ver que pasa.**
- [ ] **Step 5: Commit** `feat(races): add the animated race track`.

### Task 12: Pantalla de carreras

**Files:**
- Create: `frontend/src/pages/RacesPage.tsx`
- Modify: `frontend/src/app/routes.tsx`, `frontend/src/pages/LobbyPage.tsx`
- Test: `frontend/src/pages/RacesPage.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.getCurrentRace`, `placeRaceBet`, `watchRaces`, `useBalance`, `RaceTrack`, `animals`.
- Produces: ruta `games/races` dentro de `RequireSession`; la tarjeta `races` del lobby enlaza a `/games/races`.

- [ ] **Step 1: Pruebas que fallan** (con el cliente mock):
  - al montar pide el estado actual y, con ronda `open`, muestra la cuenta regresiva hasta `closesAt` (usando `now` del servidor), 5 animales seleccionables y un campo de monto.
  - apostar llama `placeRaceBet` con una `Idempotency-Key` estable entre reintentos, descuenta el saldo mostrado y desactiva el formulario con el mensaje de apuesta registrada.
  - con ronda `closed` o `resolved` y sin apuesta propia: muestra la carrera en curso o el resultado y "apuesta en la siguiente ronda"; no ofrece el formulario.
  - sin ronda activa (`round: null`): muestra "esperando la siguiente carrera" y se actualiza al llegar `opened`.
  - al llegar `result` anima hasta el `order` recibido; al llegar `settled` actualiza el saldo y muestra si ganó o perdió con el monto.
  - al desmontar cierra el flujo. Si el flujo se reconecta, vuelve a pedir el estado actual.
  - texto en español, sin dinero calculado en el cliente (el premio sale de la respuesta).
- [ ] **Step 2: Ejecutar y ver el fallo.**
- [ ] **Step 3: Implementar** la pantalla y la ruta; actualizar la tarjeta del lobby y su prueba.
- [ ] **Step 4: Ejecutar** `npm run lint && npm run typecheck && npm test`; con `docker compose up -d --build`, abrir http://localhost:8080 con dos cuentas y comprobar en el navegador que ambas ven la misma carrera, que el saldo del ganador sube tras la liquidación, y que un jugador que entra a mitad ve la carrera y apuesta en la siguiente.
- [ ] **Step 5: Commit** `feat(races): add the races screen`. Abrir PR 5, marcar el archivo de tareas y actualizar README §4.3 y §2.5 si algo cambió.

---

## Revisión propia

- **Cobertura del spec:** ciclo y estados (T7), apuesta idempotente y única por ronda (T4, T5), semilla oculta hasta resolver (T3, T6), SSE con bearer y reconexión (T9, T10), liquidar tras la animación (T7), pago 4,5x (T2), resultado desde un HMAC (T1), cada fallo de la tabla de fallos (T5 ronda cerrada, T7 reinicio, T8 Redis caído).
- **Fuera de este plan:** pantalla del verificador (README §5.3, igual que el de la ruleta), pruebas de carga con k6, métricas finas y panel de administración.
- **Mis decisiones al planificar:** un solo canal Redis `races` (el README nombra `race:{id}`), límite de 3 conexiones SSE por usuario, lotes de 100 apuestas, sondeo cada 1000 ms, límites de apuesta por defecto 1 y 1000, y `GET /races/current` devuelve también la última ronda recién liquidada para que quien reconecta vea el resultado.
