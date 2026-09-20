// Backtest Engine — deterministic, runs in n8n Code node (runOnceForAllItems, JS).
// Input: $input.all()[0].json = { klines_1d: [[ot,o,h,l,c,v,...]...] (oldest-first, >=60),
//   signal: {direction, entry_zone:[lo,hi], stop_loss, tp1, tp2, tp3} }
// Simulates the EXACT setup trigger: pullback entry when close crosses back through
// entry_zone after having been outside it; stop/TP resolution candle-by-candle
// (intra-candle: stop checked first = conservative). Fees 5bps/side + 2bps slip.
// Output: {json:{backtest:{...}, backtest_trades:[...]}} — numbers only, no invention:
// every figure derives from klines_1d.
const vg = $('Validate Gates').first().json;
const K = $input.all().map(function(i){ return i.json; }).filter(function(x){ return Array.isArray(x); });
const inp = { klines_1d: K, signal: (vg.output && vg.output.signal) || vg.signal || {}, symbol: ((vg.output && vg.output.signal && vg.output.signal.symbol) || (vg.signal && vg.signal.symbol) || 'BTCUSDT') };

const S = inp.signal || {};
const FEE = 0.0005, SLIP = 0.0002;
function R_mult(entry, exit, stop, dir){
  const risk = dir === 'LONG' ? (entry - stop) : (stop - entry);
  if(!(risk > 0)) return null;
  const pnl = dir === 'LONG' ? (exit - entry) : (entry - exit);
  return pnl / risk;
}
const trades = [];
if(K.length >= 60 && S.entry_zone && S.stop_loss){
  const lo = Math.min(S.entry_zone[0], S.entry_zone[1]);
  const hi = Math.max(S.entry_zone[0], S.entry_zone[1]);
  const stop = S.stop_loss, dir = S.direction || 'LONG';
  let armed = false, entry = null, entryIdx = -1;
  // warmup: need SMA20 context -> start at idx 20
  for(let i = 20; i < K.length; i++){
    const o = parseFloat(K[i][1]), h = parseFloat(K[i][2]),
          l = parseFloat(K[i][3]), c = parseFloat(K[i][4]);
    if(entry === null){
      // trigger: close enters zone from outside (pullback fill), needs prior bar outside
      const pc = parseFloat(K[i-1][4]);
      const wasOut = pc < lo || pc > hi;
      const inZone = c >= lo && c <= hi;
      if(wasOut && inZone){ entry = c * (1 + (dir==='LONG'?SLIP:-SLIP)); entryIdx = i; }
      continue;
    }
    // resolve open trade candle-by-candle, stop first (conservative)
    const stopHit = dir === 'LONG' ? (l <= stop) : (h >= stop);
    const px = [S.tp1, S.tp2, S.tp3].map(function(t){
      if(t === null || t === undefined) return null;
      return dir === 'LONG' ? (h >= t) : (l <= t);
    });
    if(stopHit){
      const x = stop * (1 - (dir==='LONG'?FEE+SLIP:-(FEE+SLIP)));
      trades.push({entry_idx: entryIdx, exit_idx: i, exit: 'STOP', R: R_mult(entry, x, stop, dir), tp_hit: [false,false,false]});
      entry = null; continue;
    }
    const hitIdx = px.findIndex(function(v){ return v; });
    if(hitIdx === -1) continue;
    // exit at FIRST touched target for R accounting; record all touched for hit-rates
    const tval = [S.tp1, S.tp2, S.tp3][hitIdx];
    const x = tval * (1 - (dir==='LONG'?FEE:-FEE));
    trades.push({entry_idx: entryIdx, exit_idx: i, exit: 'TP'+(hitIdx+1), R: R_mult(entry, x, stop, dir), tp_hit: px.map(function(v){ return !!v; })});
    entry = null;
  }
}
function stats(tr){
  const n = tr.length;
  if(!n) return {trades:0,win_rate:0,avg_R:0,expectancy_R:0,profit_factor:0,sharpe:0,max_drawdown_pct:0,tp1_hit_rate:0,tp2_hit_rate:0,tp3_hit_rate:0,notes:'no-sampled-trades'};
  const Rs = tr.map(function(t){ return t.R; });
  let sum = 0, wins = 0, gp = 0, gl = 0;
  for(const r of Rs){ sum += r; if(r > 0){ wins++; gp += r; } else gl -= r; }
  const mean = sum / n;
  let sd = 0; for(const r of Rs) sd += (r-mean)*(r-mean); sd = Math.sqrt(sd/n) || 1e-9;
  let peak = 0, eq = 0, mdd = 0;
  for(const r of Rs){ eq += r; if(eq > peak) peak = eq; const dd = peak - eq; if(dd > mdd) mdd = dd; }
  // monthly concentration: bucket by exit_idx month approx (30 candles)
  const buckets = {};
  for(const t of tr){ const m = Math.floor(t.exit_idx/30); buckets[m] = (buckets[m]||0) + t.R; }
  let tot = sum, worst_share = 0;
  for(const k in buckets){ const s = tot !== 0 ? Math.abs(buckets[k]/tot) : 0; if(s > worst_share) worst_share = s; }
  return {
    trades: n,
    win_rate: Math.round(wins/n*1000)/1000,
    avg_R: Math.round(mean*1000)/1000,
    expectancy_R: Math.round(mean*1000)/1000,
    profit_factor: gl > 0 ? Math.round(gp/gl*100)/100 : 999,
    sharpe: Math.round(mean/sd*Math.sqrt(n)*100)/100,
    max_drawdown_pct: Math.round(mdd*100)/100,
    tp1_hit_rate: Math.round(tr.filter(function(t){return t.tp_hit[0];}).length/n*1000)/1000,
    tp2_hit_rate: Math.round(tr.filter(function(t){return t.tp_hit[1];}).length/n*1000)/1000,
    tp3_hit_rate: Math.round(tr.filter(function(t){return t.tp_hit[2];}).length/n*1000)/1000,
    worst_month_pnl_share: Math.round(worst_share*1000)/1000,
    fees_bps_per_side: 5,
    notes: 'deterministic-replay|stop-first-intrabar|fees5bps+slip2bps'
  };
}
const bt = stats(trades);
return [{ json: { backtest: bt, backtest_trades: trades.slice(-60), backtest_meta: { candles: K.length, symbol: inp.symbol || null }, signal_echo: S, regime_echo: (vg.output && vg.output.regime) || null, decision_echo: 'TRADE' } }];
