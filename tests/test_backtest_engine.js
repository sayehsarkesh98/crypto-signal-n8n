// Harness for backtest_engine v3: deterministic synthetic 1D candles that oscillate
// inside a mild uptrend so the TREND_CONTINUATION LONG trigger (SMA stack + RSI 40-60
// + ADX>=20) fires repeatedly while staying single-instance (one trade at a time).
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/../engines/backtest_engine.js', 'utf8');
function buildKlines() {
  // multi-leg: flat warmup, then 4x [trend +1.0%/day x35, gentle alternated pullback x20].
  // Pullback alternates -0.4%/+0.55% so RSI sits ~50-60 (window of 14) while the
  // recent trend keeps the engine's cumulative ADX >= 20 and the SMA stack holds.
  const K = []; let c = 100;
  for (let i = 0; i < 300; i++) {
    if (i >= 70) {
      const pos = (i - 70) % 55;
      if (pos < 35) c *= 1.01;
      else c *= ((i % 2 === 0) ? 0.996 : 1.0055);
    }
    const o = i === 0 ? c : K[i-1][4];
    const w = (i % 5 - 2) * 0.08; // tiny noise
    const cc = c * (1 + w/100);
    const h = Math.max(o, cc) * 1.003, l = Math.min(o, cc) * 0.997;
    K.push([1700000000000 + i*86400000, String(o), String(h), String(l), String(cc), '1000']);
  }
  return K;
}
const K = buildKlines();
const q = { output: { signal: { symbol: 'BTCUSDT', direction: 'LONG', setup_family: 'TREND_CONTINUATION', entry_zone: [0,0], stop_loss: 0, tp1: 0, tp2: 0, tp3: 0, confidence_0_100: 80 }, regime: { zone: 'NEUTRAL', score: 55 } }, confluence_passed: 7, regime_score: 55 };
const $input = { all: () => K.map(k => ({ json: k })) };
const $ = (n) => { if (n === 'Quant Engine') return { first: () => ({ json: q }) }; throw new Error('no node ' + n); };
const res = new Function('$input', '$', code)($input, $)[0].json;
const bt = res.backtest;
console.log('meta:', JSON.stringify(res.backtest_meta));
console.log('bt:', JSON.stringify(bt));
console.log('A trades>=1 (multi-instance fires):', bt.trades >= 1);
// --- look-ahead check: independently recompute the trigger/entry/stop at each entry_idx
function C(i){ return parseFloat(K[i][4]); }
function sma(i, n){ let s=0; for(let j=i-n+1;j<=i;j++) s+=C(j); return s/n; }
let lookOk = true, count = 0;
for (const t of res.backtest_trades) {
  const i = t.entry_idx; count++;
  const c = C(i), s20 = sma(i, 20), s50 = sma(i, 50);
  if (!(c > s20 && s20 > s50)) { lookOk = false; break; } // stack must hold at entry using data<=i
  let g=0,l=0; for(let j=i-13;j<=i;j++){ const d=C(j)-C(j-1); if(d>0) g+=d; else l-=d; }
  const rsi = 100-100/(1+(g/14)/(l/14));
  if (!(rsi>40 && rsi<60)) { lookOk = false; break; } // RSI window uses only data<=i
}
console.log('B no-lookahead (stack+RSI hold at every entry with data<=i):', lookOk, '(' + count + ' sampled)');
// --- stop-first + R accounting check
let accOk = true;
for (const t of res.backtest_trades) {
  if (t.exit === 'STOP') { if (t.R > -0.98 || t.R < -1.05) accOk = false; }   // stop ≈ -1R (fees may help slightly)
  if (t.exit === 'TP1')  { if (!(t.R > 1.4 && t.R < 1.6)) accOk = false; }    // TP1 ≈ +1.5R
  if (t.exit === 'TIME') { if (!(t.R > -2 && t.R < 2.5)) accOk = false; }     // time exits in-band
  if (t.exit_idx <= t.entry_idx) accOk = false;
}
console.log('C exit accounting sane:', accOk);
// --- time-stop: no trade longer than TIME_STOP_BARS+1
let tsOk = true;
for (const t of res.backtest_trades) if (t.exit_idx - t.entry_idx > 11) tsOk = false;
console.log('D time-stop <= 11 bars:', tsOk);
// --- missing-signal fallback: quant null-features shape → 0 trades, flat output
const qBad = { output: { decision: 'NO_TRADE', no_trade_reason: 'missing-indicators', signal: { symbol:'NONE', direction:'NEUTRAL', setup_family:'', entry_zone:[0,0], stop_loss:0, tp1:0, tp2:0, tp3:0, confidence_0_100:0, time_stop_1h_candles:0, invalidation:'', scenario_pair:{base_path:'',invalidation_path_second_order:''} }, backtest_est: { trades:0,expectancy_R:null,profit_factor:null,tp1_hit_rate:null,tp2_hit_rate:null,must_validate:true }, regime: { score:0,zone:'NEUTRAL',drivers:[] }, confluences: [] }, quant_meta: { engine:'quant-v2-multi' } };
const $2 = (n) => ({ first: () => ({ json: qBad }) });
const res2 = new Function('$input', '$', code)($input, $2)[0].json;
console.log('E missing-signal fallback (0 trades, echo kept):', res2.backtest.trades === 0 && res2.signal_echo.confidence_0_100 === 0 && !('output' in res2));
// --- flat data → 0 trades
const Kf = []; for (let i=0;i<250;i++) Kf.push([1700000000000+i*86400000,'100','100.1','99.9','100','1000']);
const $inputF = { all: () => Kf.map(k => ({ json: k })) };
const resF = new Function('$input', '$', code)($inputF, $)[0].json;
console.log('F flat-data 0 trades:', resF.backtest.trades === 0 && resF.backtest.notes.includes('no-sampled-trades'));
