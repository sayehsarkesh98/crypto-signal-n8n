# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A deterministic crypto-signal system for n8n. There is no app to build, no package.json, and no test suite. The deployable artifacts are the two n8n workflow exports (`workflow_export.json` — main signal workflow, `tracker_export.json` — outcome tracker); the JS files in `engines/` are the editable source of the workflow's Code nodes. Both workflows are active on a live n8n instance (ids `UJZtZI0WcaDN0jDs` and `ObXSAehgsmWcVCfK`); changes here only take effect after re-importing the JSON into n8n and publishing.

The only local check available is `node --check engines/<file>.js` (syntax only — engine files use n8n globals `$input`, `$()`, `$helpers` and cannot run under plain node).

## Syncing engines/ with the workflow exports

`engines/*.js` is canonical; each file is embedded verbatim (whitespace-only differences) in a Code node of `workflow_export.json`. After editing an engine file, push it back into the export:

```bash
jq --arg n "Quant Engine" --rawfile src engines/quant_engine.js \
  '(.workflow.nodes[] | select(.name==$n) | .parameters.jsCode) = $src' \
  workflow_export.json > workflow_export.json.new && mv workflow_export.json.new workflow_export.json
```

Node-name ↔ file map: Compute Indicators → `compute_indicators.js`, Quant Engine → `quant_engine.js`, Backtest Engine → `backtest_engine.js`, Validate Gates → `validate_gates.js`, Narrator FA → `narrator_fa.js`, Log NO_TRADE → `log_no_trade.js`, Sanitize Telegram Text → `sanitize_telegram.js`. `Log Gate Fail` is a second Code node carrying the same `log_no_trade.js` (dedicated single-edge receiver for the gate-fail branch — a dual-inbound junction on one node silently dead-ends when one source finishes with 0 items). Tracker code lives in `tests/evaluate_outcomes.js` (Evaluate Outcomes) — same sync pattern. Test harnesses (`tests/test_*.js`) mock `$input`/`$` and run under plain `node tests/test_<name>.js`. Extract a node's code with `jq -r '.workflow.nodes[] | select(.name=="…") | .parameters.jsCode'`.

**Live instance + deploy model:** both workflows run on n8n cloud at `shadow98.app.n8n.cloud` (ids `UJZtZI0WcaDN0jDs` / `ObXSAehgsmWcVCfK`, ledger table `eOctngGT0qLnzQ54`, project `ZZCsYexXoYT4B5nY`). Deploy via the n8n MCP server (`update_workflow` with operation objects, then **`publish_workflow`** — updates land on a draft; production executions keep running the last published version until you publish). Gotcha: `addConnection`/`removeConnection` ignore flat `sourcePort/targetPort` fields — to target a specific IF output use `sourceOutput`/`targetInput`; flat fields silently connect output 0. This repo's exports mirror the live published workflows (Log Gate Fail included, 34 nodes).

## Main workflow architecture (every 4h at :35)

```
Schedule (:35) ─fan-out→ 11 HTTP nodes ──→ Merge Inputs (5 inputs) → Compute Indicators → Quant Engine
Quant Engine → Is TRADE? ($json.output.decision == "TRADE")
  TRUE:  Fetch 1D History → Backtest Engine → Validate Gates → Gates Pass? (IF on $json.gate_check.passed)
         TRUE:  Ledger Insert → Narrator FA → Sanitize Telegram Text → Telegram HTTP Sender
         FALSE: Log Gate Fail → Narrator FA → Sanitize Telegram Text → Telegram HTTP Sender
  FALSE: Log NO_TRADE → Narrator FA → Sanitize Telegram Text → Telegram HTTP Sender
```

Key mechanic: only 5 data sources flow through Merge Inputs (spot tickers, BTC 4H klines, BTC funding, Fear&Greed, CoinGecko global). The other 8 HTTP nodes (ETH/SOL/BNB klines and funding) have **no outgoing connections** — Compute Indicators reads them via n8n cross-node references (`$('Fetch ETH Klines').all()` in `grab()`/`grabFund()`). Keep node names in sync with the `nodeMap` in `compute_indicators.js` if renaming.

HTTP sources: Binance spot `ticker/24hr` (10 pairs) + `klines` (4H ×4, 1D ×400 on the trade branch), Binance futures `premiumIndex` (funding, ×4), alternative.me FNG (7d), CoinGecko `/global`. The Telegram bot token and the 9router LLM API key are **redacted from the JSON exports** (placeholders `{{TELEGRAM_BOT_TOKEN}}` / `{{LLM_API_KEY}}`); substitute real values after importing into n8n — never commit them. `chat_id 6643216800` is hardcoded in the narrator/sanitizer code nodes.

**Dead LLM island:** `Signal Agent` + `Fable Model` + `Signal JSON Parser` (langchain nodes) and the `Build LLM Body → LLM HTTP Call → Parse LLM JSON` / `LLM Caller` chains are fully disconnected — no inputs from the pipeline, nothing consumes their outputs. The v1.1 commit replaced AI decision-making with the deterministic Quant Engine; these nodes are unused scaffolding. Don't route data through them.

## Decision logic (quant_engine.js)

- **Regime** (BTC-based, 6 components): btcTrend 25% + alt breadth 20% + dominance 15% + funding 15% + drawdown/vol 15% + momentum 10%. Zones: ≥80 RISK_ON, 40–79 NEUTRAL, <40 RISK_OFF.
- **Sentiment composite** = 0.4·FearGreed + 0.4·50 + 0.2·momentum. It only vetoes/taxes: LONG vetoed at ≥81, SHORT at ≤20, and confidence gets a −5 tax in the 61–80 (long) / 21–40 (short) bands.
- **Setups per symbol** (BTC/ETH/SOL/BNB): `TREND_CONTINUATION` (SMA stack + 40<RSI<60 + ADX≥20) or `RANGE_FADE` (no trend + Bollinger half + RSI<35/>65 + ADX<20). 9 confluence checks; qualifying needs ≥6 passed and confidence ≥75. Confidence = 70 + min(12, passed) − sentiment tax − 10 if RISK_OFF. Best candidate wins by confidence → passed → pullback quality (|close−SMA20|/ATR).
- **Levels**: entry = min/max(close, SMA20) ± 0.25×ATR; stop beyond the 20-bar extreme or entry ∓ 1×ATR, plus 0.25×ATR buffer; TP1/TP2/TP3 at 1.5R/2.5R/4R; time stop 24 1H candles.
- NO_TRADE carries a diagnostic reason string (`no-qualifier-4sym: SYM:conf/pass | …` listing every symbol's score).

## Backtest + gates (backtest_engine.js, Validate Gates)

Backtest Engine v3 replays the setup as **multi-instance with no look-ahead**: at every historical 1D bar it re-derives the live setup's family/direction triggers (SMA20/50 stack, RSI14, ADX14, 20-bar H/L — same formulas as Compute Indicators) from data up to that bar, enters at that bar's close, and resolves forward bar-by-bar (stop first = conservative; TP1/2/3 at 1.5/2.5/4R of that instance's own ATR risk; TIME exit after 10 bars at the close). One trade open at a time; fees 5bps/side + 2bps slip. (v2's anachronism — today's 4H levels replayed over 400 past days — is what this replaced.) `Validate Gates` now runs **after** Backtest Engine and gates the real replay: trades≥30, expectancy>0.15R, PF≥1.4, TP1 hit ≥0.55, TP2 ≥0.35, confidence ≥75. The `Gates Pass?` IF node makes the gates **blocking**: pass → Ledger Insert; fail → Log NO_TRADE with a `gate-failed:` reason listing the failed gates (Telegram still gets the message, including the real backtest numbers). Narrator reads the full context via `$('Validate Gates')` (its direct `$input` is the Ledger Insert row — a Data Table insert does not pass input through); on the Quant-NO_TRADE branch that read throws and Narrator falls back to `$input`. In the tracker, Evaluate Outcomes must flatten **all** `Fetch Ticker` items with `.all()` — the HTTP node splits the 4-symbol ticker array into one item per symbol, so `.first()` sees only BTCUSDT.

## Signal Tracker (tracker_export.json, every 4h at :40)

Schedule → Fetch Ticker (4 pairs) → Ledger Get OPEN → Evaluate Outcomes → Ledger Update → Sanitize Outcome → Telegram. Each OPEN row is checked against the live price at that moment: STOP if beyond stop_loss (−1R), TP1 if reached (+1.4R recorded, i.e. 1.5 − fees), or TIME_STOP once the row is older than `time_stop` hours (default 24, from `time_stop_1h_candles: 24`) with the signed R of the live price — before v3, rows that never hit either level stayed OPEN forever. STOP wins if both hit at check time; there is no intrabar sequencing. Two splitter traps to keep in mind: the HTTP node splits the ticker array into 4 items (Evaluate Outcomes flattens all of them — `.first()` sees only BTCUSDT), and Ledger Get OPEN therefore runs once per ticker item, so rows arrive duplicated and the code dedupes by row id. Purpose: build real-world hit statistics to retune the engine's thresholds (confluences, confidence floor, RSI veto).

**Data store:** n8n Data Table `eOctngGT0qLnzQ54` (the "signal_ledger"). Columns: `created_at, symbol, direction, setup_family, entry_mid, stop_loss, tp1, tp2, tp3, confidence, confluence_passed, regime_score, status (OPEN|STOP|TP1|TIME_STOP), exit_price, outcome_R, closed_at`. `confluence_passed` and `regime_score` are echoed from Quant Engine through Backtest Engine — a Data Table insert drops unmapped input fields, so any new stat must be added to that echo chain first. The table id is instance-specific — re-link `dataTableId` in Ledger Insert/Get/Update after importing into a fresh n8n instance.

## Conventions

- User-facing messages are Persian; `narrator_fa.js` and the tracker's `Sanitize Outcome` build them. `sanitize_telegram.js` strips control chars and caps length at 3500 (tracker version: 1000).
- All numbers must derive from workflow input; nothing is invented downstream (the engines' explicit contract).
- Not financial advice disclaimer is appended to every Telegram message.
