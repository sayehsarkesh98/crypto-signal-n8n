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

Node-name ↔ file map: Compute Indicators → `compute_indicators.js`, Quant Engine → `quant_engine.js`, Backtest Engine → `backtest_engine.js`, Narrator FA → `narrator_fa.js`, Log NO_TRADE → `log_no_trade.js`, Sanitize Telegram Text → `sanitize_telegram.js`. Extract a node's code with `jq -r '.workflow.nodes[] | select(.name=="…") | .parameters.jsCode'`.

## Main workflow architecture (every 4h at :35)

```
Schedule (:35) ─fan-out→ 11 HTTP nodes ──→ Merge Inputs (5 inputs) → Compute Indicators → Quant Engine
Quant Engine → Is TRADE? ($json.output.decision == "TRADE")
  TRUE:  Validate Gates → Fetch 1D History → Backtest Engine → Ledger Insert → Narrator FA → Sanitize Telegram Text → Telegram HTTP Sender
         Validate Gates → Build Telegram Payload          (terminal; not wired onward — legacy)
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

Backtest Engine replays the exact setup over the 1D klines: armed when a close crosses into `entry_zone` from outside; per candle, stop is checked before TPs (conservative); fees 5bps/side + 2bps slip. `Validate Gates` hard-fails unless trades≥30, expectancy>0.15R, PF≥1.4, TP1 hit ≥0.55, TP2 ≥0.35, confidence ≥75 — but the gates are **advisory, not blocking**: Quant Engine always emits `backtest_est.trades = 0`, so `gate_check.passed` is always false and the signal is still fetched, backtested, ledged, and sent. Real backtest stats flow into the Telegram message via Backtest Engine output. The trade-branch Narrator reads that output through the cross-node reference `$('Backtest Engine')` — its direct `$input` is the Ledger Insert row (inserted columns only, no backtest fields; a Data Table insert does not pass input through). On the NO_TRADE branch that read throws and Narrator falls back to `$input` (the Log NO_TRADE echo). In the tracker, Evaluate Outcomes must flatten **all** `Fetch Ticker` items with `.all()` — the HTTP node splits the 4-symbol ticker array into one item per symbol, so `.first()` sees only BTCUSDT.

## Signal Tracker (tracker_export.json, every 4h at :40)

Schedule → Fetch Ticker (4 pairs) → Ledger Get OPEN → Evaluate Outcomes → Ledger Update → Sanitize Outcome → Telegram. Each OPEN row is checked against the live price at that moment: STOP if beyond stop_loss (−1R), TP1 if reached (+1.4R recorded, i.e. 1.5 − fees). STOP wins if both hit at check time; there is no intrabar sequencing. Purpose: build real-world hit statistics to retune the engine's thresholds (confluences, confidence floor, RSI veto).

**Data store:** n8n Data Table `eOctngGT0qLnzQ54` (the "signal_ledger"). Columns: `created_at, symbol, direction, setup_family, entry_mid, stop_loss, tp1, tp2, tp3, confidence, confluence_passed, regime_score, status (OPEN|STOP|TP1), exit_price, outcome_R, closed_at`. The table id is instance-specific — re-link `dataTableId` in Ledger Insert/Get/Update after importing into a fresh n8n instance.

## Conventions

- User-facing messages are Persian; `narrator_fa.js` and the tracker's `Sanitize Outcome` build them. `sanitize_telegram.js` strips control chars and caps length at 3500 (tracker version: 1000).
- All numbers must derive from workflow input; nothing is invented downstream (the engines' explicit contract).
- Not financial advice disclaimer is appended to every Telegram message.
