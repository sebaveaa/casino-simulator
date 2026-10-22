# Diseño: módulo Carreras de animales (primera entrega)

Fecha: 2026-10-19. Fuente de verdad del diseño general: `README.md` §2.5, §3, §4.3, §5.2, §6. Este documento fija las decisiones de la primera entrega; lo que no contradice al README sigue el README.

## 1. Intención

Las carreras son el juego núcleo más exigente en concurrencia: una ronda compartida por muchos jugadores, con ventana de apuestas, tiempo real, cierre, carrera y liquidación masiva. Aportan el valor arquitectónico del proyecto (worker, SSE con Redis pub/sub, liquidación idempotente, *provably fair* compartido). El juego es el pretexto; lo que se defiende es esa arquitectura.

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos**
- Una vertical delgada de punta a punta: worker, apuesta, SSE, carrera animada y liquidación, funcionando con lo mínimo.
- Respetar todas las invariantes de `AGENTS.md` (dinero solo por Wallet, ledger de doble entrada, una apuesta = una transacción, idempotencia, dinero entero, el servidor decide, `resolve` puro y compartido, PostgreSQL como fuente de verdad, configuración por entorno).
- Resultado verificable por cualquier jugador una vez revelada la semilla.

**No objetivos (primera entrega)**
- Apuestas a podio o a posiciones, varias selecciones por ronda, animales con cuotas distintas, número de animales configurable.
- Rondas iniciadas por un administrador, repetición de carreras pasadas.
- Pruebas de carga con k6 y métricas finas (entrega final).

**Anti-objetivos (aunque "funcione", sería un fallo)**
- Que el cliente decida o calcule resultados o saldos.
- Que una apuesta se cobre dos veces, o un premio se pague dos veces tras reiniciar el worker.
- Aceptar una apuesta después de `closes_at`.
- Que la semilla de una ronda se conozca antes del resultado, o que cambie tras ver las apuestas.

## 3. Decisiones del usuario

- Tipo de apuesta: **solo ganador**.
- **5 animales, misma probabilidad (1/5), pago fijo igual** para todos.
- **Una sola apuesta por jugador por ronda** (un animal y un monto, una `Idempotency-Key`).
- Ciclo **continuo y automático**: el worker abre, cierra, corre, liquida y abre la siguiente.
- El orden de llegada completo sale **del mismo HMAC** que el ganador; el pago depende solo del primero.
- El jugador que entra a mitad de una ronda **pide el estado actual** (`GET /races/current`), ve la carrera en curso y apuesta en la siguiente.
- Alcance: **vertical delgada** de punta a punta, luego verificador y pulido.
- **Autenticación del SSE**: el cliente usa `fetch` con lectura de stream y la cabecera `Authorization: Bearer`, no `EventSource`. La reconexión y el reintento los implementa el cliente. El token no viaja en la URL.
- **Tiempos**: al vencer la ventana, la ronda se cierra y se corre. El worker espera a que termine la animación (~10 s) antes de liquidar, para que el saldo no revele el resultado antes de verlo. La siguiente ronda se abre al quedar `settled`.

## 4. Decisiones mías (a revisar)

- **Pago 4,5x con la apuesta incluida**, calculado como `stake * 9 / 2` con división entera hacia abajo (el resto se queda en la casa). Con 1/5 de probabilidad, el margen de la casa es de aproximadamente 10 %. La ruleta usa multiplicadores enteros; aquí no se puede, por eso el redondeo explícito.
- **Ventana de apuestas de ~30 s y carrera de ~10 s**, configurables por variables de entorno (se añaden a `.env.example`).
- **Límites de apuesta** mínimo y máximo, configurables por entorno; `stake > 0` ya lo exige la base de datos.
- **Estados de la ronda en la base de datos**: los del esquema existente, `open`, `closed`, `resolved`, `settled`, que corresponden a Abierta, Cerrada, Corrida, Liquidada del README. No se cambia el esquema de estados.
- **Resultado de la ronda**: `{ winner, order }`, con `order` una permutación de los 5 animales; `winner = order[0]`.
- **Una apuesta por jugador por ronda** se hace cumplir con un índice único parcial en `bets (round_id, user_id)`: migración nueva.
- **Idempotencia del premio**: clave de transacción derivada del id de la apuesta (por ejemplo `payout:{betId}`) y estado `pending` → `settled` de la apuesta, en la misma transacción que el crédito.
- **Las apuestas perdedoras** no generan movimiento al liquidar (el cobro ya fue a la casa al apostar); solo pasan a `settled` con `payout = 0`.
- **Rutas nuevas** definidas en `apiPaths` (`shared/`): apuesta (`/games/races/bets`), estado actual (`/races/current`), flujo SSE (`/races/stream`) y datos de una ronda para el verificador. Los nombres exactos los fija el constructor.
- **La tarjeta "Carreras de animales" del lobby** pasa a enlazar a `/games/races`.
- **Dónde se guarda el resultado**: la migración nueva añade a `game_rounds` las columnas `result jsonb`, `resolved_at` y `settled_at`, además del índice único parcial de `bets`. El resultado se guarda al pasar a `resolved`; no se recalcula en cada lectura.
- **Secreto de la semilla**: `server_seed` sigue guardado en `game_rounds` (como en el modelo del README), pero ningún endpoint ni evento lo expone mientras la ronda esté en `open` o `closed`. Solo se proyecta al pasar a `resolved`. Los endpoints leen con una selección explícita de columnas, nunca `select *`.
- **Worker**: un bucle de sondeo con intervalo corto que mueve el estado de las rondas vencidas. Cada transición toma la fila de la ronda con `SELECT … FOR UPDATE SKIP LOCKED`, así que correr más de un worker es seguro. Hay una sola ronda activa a la vez: la siguiente solo se abre cuando la anterior queda `settled`. Al reiniciar, una ronda `open` ya vencida se cierra y se corre, y las rondas `resolved` sin liquidar se liquidan antes de abrir otra.
- **Estado de las apuestas**: solo `pending` → `settled`. No se usa `in_progress` (es del blackjack). La idempotencia del pago (`payout:{betId}`) evita el doble pago aunque dos lotes coincidan.
- **Límites por defecto**: mínimo y máximo de apuesta configurables por entorno, validados en `shared/` para que el pago posible nunca supere `MAX_MONEY` (misma regla que la ruleta). La casa es una cuenta del sistema que puede quedar en negativo; no se limita la apuesta por la solvencia de la casa.
- **Derivación del resultado**: la defino libremente (no hay otros consumidores todavía). Debe usar bits del HMAC sin sesgo de módulo y quedar fija, porque el verificador del navegador la repite.

## 5. Comportamiento

**Ciclo de la ronda (worker)**
1. *Abierta* (`open`): crea la ronda con `server_seed` nuevo, guarda su hash, fija `opens_at` y `closes_at`, publica `abierta` con `closes_at` y el hash.
2. *Cerrada* (`closed`): al vencer la ventana publica `cerrada`.
3. *Corrida* (`resolved`): calcula el resultado con `HMAC-SHA256(server_seed, round_id)` y la función pura compartida, guarda el resultado, publica `resultado` con la semilla revelada.
4. *Liquidada* (`settled`): recorre las apuestas pendientes por lotes, acredita premios, publica `liquidada`. Si el worker se cae, al reiniciar retoma las rondas no liquidadas sin pagar dos veces.
5. Abre la siguiente ronda.

**Apuesta (REST)**
- Exige `Idempotency-Key`. Una transacción: bloquea el wallet, descuenta el monto hacia la casa, inserta la apuesta como `pending` con `round_id`.
- Se rechaza si `now() >= closes_at` (reloj de PostgreSQL), si la ronda no está abierta, si el jugador ya apostó en esa ronda, o si el saldo no alcanza.
- Un reintento con la misma clave devuelve el resultado original. Reutilizar la clave con otro animal u otro monto se rechaza con `409 conflict`, como en la ruleta.

**Tiempo real**
- SSE autenticado, un canal público de eventos por ronda en Redis pub/sub; cualquier instancia del backend los reenvía a sus clientes. No se envía información de otros jugadores.
- Al conectar o reconectar, el cliente pide `GET /races/current` y luego escucha. Los eventos no son fuente de verdad.
- Si Redis cae, el worker pausa la apertura de nuevas rondas; las ya apostadas se liquidan. Si cae PostgreSQL, no se aceptan apuestas.

**Frontend**
- Pantalla con 5 animales, cuenta regresiva (desde `closes_at`), selector de animal y monto, carrera animada con PixiJS hasta el orden ya decidido, y resultado con saldo actualizado.
- Interfaz en español. Cliente HTTP real y cliente mock deben mantenerse al día con los nuevos endpoints.
- Quien entra con la ronda cerrada o corriendo ve el estado actual y apuesta en la siguiente.

**Resultado verificable**
- `resolve` puro en `shared/` que, dados `server_seed` y `round_id`, produce `{ winner, order }`. El navegador ya puede reusar el mismo código para verificar tras la revelación (README §5.3).

## 6. Restricciones

- Node 22, TypeScript, Fastify, Kysely, Redis, PixiJS. Dinero entero en `BigInt`, texto en la API.
- Todo flujo de dinero por el servicio Wallet.
- Cambios por PR de unas 400 líneas, apilados; issue y archivo de tareas en `odd/tasks/` antes del primer cambio de código (`AGENTS.md`).
- Las pruebas de integración con PostgreSQL usan `TEST_DATABASE_URL`.

## 7. Qué queda al constructor

- Nombres y diseño visual de los 5 animales y la pista.
- Forma exacta del evento SSE y de las rutas, validación con Zod en `shared/`.
- Cómo derivar el orden completo del HMAC (por ejemplo, mezcla de Fisher-Yates con `Rng`), siempre determinista.
- Tamaño de los lotes de liquidación y estrategia de reintentos.
- Estructura interna de `backend/games/races/`, `backend/realtime/` y `backend/worker/`.
- División en PRs apilados.
