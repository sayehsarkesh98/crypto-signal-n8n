const fs = require('fs');
const code = fs.readFileSync(__dirname + '/../engines/narrator_fa.js', 'utf8');
function run(name, inputJson, backtestJson) {
  const $input = { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] };
  const $ = (n) => { if (n === 'Backtest Engine') { if (backtestJson === null) throw new Error('not executed'); return { first: () => ({ json: backtestJson }) }; } throw new Error('no node ' + n); };
  return new Function('$input', '$', code)($input, $);
}
// CASE 1: TRADE branch — input is Ledger Insert row (no backtest), cross-node has backtest
const bt = { backtest: { trades: 12, expectancy_R: 0.32, profit_factor: 1.6, tp1_hit_rate: 0.61, tp2_hit_rate: 0.4, max_drawdown_pct: 2.1 }, signal_echo: { symbol: 'ETHUSDT', direction: 'LONG', setup_family: 'TREND_CONTINUATION', entry_zone: [2490, 2510], stop_loss: 2450, tp1: 2560, tp2: 2600, tp3: 2680, confidence_0_100: 78, invalidation: 'x' }, regime_echo: { zone: 'NEUTRAL', score: 58 } };
const row = { id: 7, symbol: 'ETHUSDT', direction: 'LONG', status: 'OPEN', entry_mid: 2500 };
const r1 = run('trade', row, bt);
const t1 = r1[0].json.text;
console.log('C1 TRADE-msg:', t1.includes('✅') && t1.includes('ETHUSDT') && t1.includes('بک‌تست واقعی') ? 'PASS' : 'FAIL\n' + t1);
console.log('C1 regime:', t1.includes('NEUTRAL (58)') ? 'PASS' : 'FAIL');
// CASE 2: NO_TRADE branch — Backtest Engine not executed, input is Log NO_TRADE echo
const logOut = { decision: 'NO_TRADE', reason: 'no-qualifier-4sym: BTCUSDT:no-setup', signal: {}, regime: { zone: 'RISK_OFF', score: 30 }, confluences: [] };
const r2 = run('notrade', logOut, null);
const t2 = r2[0].json.text;
console.log('C2 NO_TRADE-msg:', t2.includes('⛔') && t2.includes('no-qualifier-4sym') && t2.includes('RISK_OFF (30)') ? 'PASS' : 'FAIL\n' + t2);
// CASE 3: TRADE branch but cross-node throws AND input is ledger row → must not crash, degrade to 'بدون معامله'? 
// (belt-and-braces: narrator never sees backtest; expect graceful NO_TRADE text, no exception)
const r3 = run('degraded', row, null);
console.log('C3 no-crash:', r3[0].json.text.length > 0 ? 'PASS' : 'FAIL');
