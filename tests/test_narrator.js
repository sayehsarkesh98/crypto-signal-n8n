const fs = require('fs');
const code = fs.readFileSync(__dirname + '/../engines/narrator_fa.js', 'utf8');
function run(inputJson, gatesJson) {
  const $input = { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] };
  const $ = (n) => { if (n === 'Validate Gates') { if (gatesJson === null) throw new Error('not executed'); return { first: () => ({ json: gatesJson }) }; } throw new Error('no node ' + n); };
  return new Function('$input', '$', code)($input, $);
}
const bt = { trades: 41, expectancy_R: 0.21, profit_factor: 1.55, tp1_hit_rate: 0.58, tp2_hit_rate: 0.39, max_drawdown_pct: 3.2 };
const sig = { symbol: 'ETHUSDT', direction: 'LONG', setup_family: 'TREND_CONTINUATION', entry_zone: [2490, 2510], stop_loss: 2450, tp1: 2560, tp2: 2600, tp3: 2680, confidence_0_100: 78, invalidation: '4H close beyond stop' };
const vgPass = { backtest: bt, signal_echo: sig, regime_echo: { zone: 'NEUTRAL', score: 58 }, confluence_passed: 7, regime_score: 58, gate_check: { passed: true, failed_gates: [] } };
const vgFail = Object.assign({}, vgPass, { gate_check: { passed: false, failed_gates: ['trades<30', 'PF<1.4'] } });
// CASE 1: TRADE — gates passed
const t1 = run({ id: 7, symbol: 'ETHUSDT', status: 'OPEN' }, vgPass)[0].json.text;
console.log('C1 TRADE:', t1.includes('✅') && t1.includes('ETHUSDT') && t1.includes('بک‌تست واقعی') && t1.includes('NEUTRAL (58)') ? 'PASS' : 'FAIL\n' + t1);
// CASE 2: gate-failed → NO_TRADE WITH real backtest + failed gates listed
const t2 = run({ id: 7, symbol: 'ETHUSDT', status: 'OPEN' }, vgFail)[0].json.text;
console.log('C2 GATE-FAIL:', t2.includes('⛔') && t2.includes('gate-failed') && t2.includes('trades<30') && t2.includes('بک‌تست واقعی') ? 'PASS' : 'FAIL\n' + t2);
// CASE 3: Quant NO_TRADE branch — cross-node read throws, Log NO_TRADE echo as input
const t3 = run({ decision: 'NO_TRADE', reason: 'no-qualifier-4sym: BTCUSDT:no-setup', signal: {}, regime: { zone: 'RISK_OFF', score: 30 } }, null)[0].json.text;
console.log('C3 NO_TRADE:', t3.includes('⛔') && t3.includes('no-qualifier-4sym') && t3.includes('RISK_OFF (30)') ? 'PASS' : 'FAIL\n' + t3);
// CASE 4: degenerate — ledger row input, no Validate Gates available → no crash
const t4 = run({ id: 7, symbol: 'ETHUSDT', status: 'OPEN' }, null)[0].json.text;
console.log('C4 no-crash:', t4.length > 0 ? 'PASS' : 'FAIL');
