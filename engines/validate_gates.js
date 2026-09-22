// Validate Gates v2 — now runs AFTER Backtest Engine (was: before Fetch 1D, where the
// real backtest did not exist yet and backtest_est.trades was always 0 → gates dead).
// Gates the REAL multi-instance replay: sample size, expectancy, profit factor, TP hit
// rates, and signal confidence (backtest-expert methodology: minimum 30 trades; the
// replay already prices in friction — 5bps fees/side + 2bps slip, stop-first intrabar).
// Output = full passthrough + gate_check. The new "Gates Pass?" IF node blocks
// non-passers (TRUE → Ledger Insert, FALSE → Log NO_TRADE gate-failed reason).
const o = ($input.all()[0] && $input.all()[0].json) || {};
const b = o.backtest || {};
const s = o.signal_echo || o.signal || {};
const fails = [];
if ((b.trades||0) < 30) fails.push("trades<30");
if (!((b.expectancy_R||0) > 0.15)) fails.push("expectancy<=0.15R");
if (!((b.profit_factor||0) >= 1.4)) fails.push("PF<1.4");
if (!((b.tp1_hit_rate||0) >= 0.55)) fails.push("TP1<0.55");
if (!((b.tp2_hit_rate||0) >= 0.35)) fails.push("TP2<0.35");
if (!((s.confidence_0_100||0) >= 75)) fails.push("conf<75");
return [{ json: Object.assign({}, o, { gate_check: { passed: fails.length===0, failed_gates: fails }, validated_at: new Date().toISOString() }) }];
