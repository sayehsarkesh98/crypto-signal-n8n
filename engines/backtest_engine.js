// Backtest Engine v3 — deterministic MULTI-INSTANCE replay (no look-ahead).
// v2 bug (fixed): the single live signal's levels — built from TODAY's 4H ATR and
// 20-bar extremes — were replayed over 400 PAST daily candles. Today's zones almost
// never touched historical prices, so the "backtest" usually returned 0 trades and
// the numbers it did produce were anachronistic (look-ahead bias).
// v3: at every historical bar, recompute the same setup (setup_family + direction)
// using ONLY data up to that bar (SMA20/50, RSI14, ATR14, ADX14, 20-bar H/L — same
// formulas as Compute Indicators), enter at that bar's close, then resolve forward
// bar-by-bar: stop checked first (conservative), TP1/2/3 at 1.5/2.5/4R of that
// instance's own risk, time-stop after TIME_STOP_BARS bars at the bar close.
// Fees 5bps/side + 2bps slip kept; one trade open at a time (sequential, no overlap).
// Signal/context now echo from Quant Engine — Validate Gates has MOVED to after this
// node (Gates Pass? IF blocks non-passers), so the old $('Validate Gates') read is gone.
// Output shape unchanged: {backtest, backtest_trades, backtest_meta, signal_echo,
// regime_echo, confluence_passed, regime_score, decision_echo}.
const q = $('Quant Engine').first().json;
const K = $input.all().map(function(i){ return i.json; }).filter(function(x){ return Array.isArray(x); });
const OUT = (q.output || {});
const S = OUT.signal || {};
const dir = S.direction || 'LONG';
const fam = S.setup_family || 'TREND_CONTINUATION';
const FEE = 0.0005, SLIP = 0.0002, TIME_STOP_BARS = 10, WARM = 60;

function fnum(x){ const v = parseFloat(x); return isNaN(v) ? null : v; }
const H = K.map(function(r){ return fnum(r[2]); });
const L = K.map(function(r){ return fnum(r[3]); });
const C = K.map(function(r){ return fnum(r[4]); });
function smaAt(a, i, n){ if(i+1 < n) return null; let s=0; for(let j=i-n+1;j<=i;j++) s+=a[j]; return s/n; }
function rsiAt(i, n){ if(i < n) return null; let g=0,l=0; for(let j=i-n+1;j<=i;j++){ const d=C[j]-C[j-1]; if(d>0) g+=d; else l-=d; } if(l===0) return 100; return 100-100/(1+(g/n)/(l/n)); }
function atrAt(i, n){ if(i < n) return null; let s=0; for(let j=i-n+1;j<=i;j++){ s+=Math.max(H[j]-L[j], Math.abs(H[j]-C[j-1]), Math.abs(L[j]-C[j-1])); } return s/n; }
function adxAt(i, n){ if(i < n*2+1) return null; let plus=0,minus=0,tr=0; for(let j=i-n*2+1;j<=i;j++){ const up=H[j]-H[j-1], dn=L[j-1]-L[j]; tr+=Math.max(H[j]-L[j], Math.abs(H[j]-C[j-1]), Math.abs(L[j]-C[j-1])); if(up>dn&&up>0) plus+=up; if(dn>up&&dn>0) minus+=dn; } const dip=tr>0?100*plus/tr:0, dim=tr>0?100*minus/tr:0; const sum=dip+dim; return sum>0?100*Math.abs(dip-dim)/sum:0; }
function hiLoAt(i, n){ if(i+1 < n) return [null,null]; let hh=null, ll=null; for(let j=i-n+1;j<=i;j++){ if(hh===null||H[j]>hh) hh=H[j]; if(ll===null||L[j]<ll) ll=L[j]; } return [hh,ll]; }
function R_mult(entry, exit, stop, d){ const risk = d==='LONG' ? entry-stop : stop-entry; if(!(risk>0)) return null; const pnl = d==='LONG' ? exit-entry : entry-exit; return pnl/risk; }

const trades = [];
if(K.length >= WARM+30 && S.entry_zone && (!OUT.decision || OUT.decision === 'TRADE')){
  let open = null; // {i, entry(exec), stop, tps[3], tp_hit[3]}
  for(let i = WARM; i < K.length; i++){
    if(open){
      if(L[i]===null || H[i]===null) continue; // data hole: trade stays open
      const stopHit = dir==='LONG' ? (L[i] <= open.stop) : (H[i] >= open.stop);
      if(stopHit){
        const x = open.stop * (1 - (dir==='LONG' ? FEE+SLIP : -(FEE+SLIP)));
        trades.push({entry_idx: open.i, exit_idx: i, exit:'STOP', R: R_mult(open.entry, x, open.stop, dir), tp_hit: open.tp_hit});
        open = null;
      } else {
        const px = [open.tps[0], open.tps[1], open.tps[2]].map(function(t){ return t===null ? null : (dir==='LONG' ? (H[i] >= t) : (L[i] <= t)); });
        const hit = px.findIndex(function(v){ return v; });
        if(hit !== -1){
          const tval = open.tps[hit];
          const x = tval * (1 - (dir==='LONG' ? FEE : -FEE));
          open.tp_hit = px.map(function(v){ return !!v; });
          trades.push({entry_idx: open.i, exit_idx: i, exit:'TP'+(hit+1), R: R_mult(open.entry, x, open.stop, dir), tp_hit: open.tp_hit});
          open = null;
        } else if(i - open.i >= TIME_STOP_BARS){
          const x = C[i] * (1 - (dir==='LONG' ? FEE+SLIP : -(FEE+SLIP)));
          trades.push({entry_idx: open.i, exit_idx: i, exit:'TIME', R: R_mult(open.entry, x, open.stop, dir), tp_hit: open.tp_hit});
          open = null;
        }
      }
      continue; // resolution bar never triggers a new entry (sequential, matches v2)
    }
    // --- setup trigger at bar i, using only data <= i ---
    const c = C[i]; if(c===null) continue;
    const sma20 = smaAt(C,i,20), sma50 = smaAt(C,i,50);
    const rsi = rsiAt(i,14), atr = atrAt(i,14), adx = adxAt(i,14);
    if(sma20===null || sma50===null || rsi===null || atr===null || atr<=0) continue;
    const up = c>sma20 && sma20>sma50, dn = c<sma20 && sma20<sma50;
    let trig = false;
    if(fam === 'TREND_CONTINUATION'){
      trig = (rsi>40 && rsi<60) && (adx!==null && adx>=20) && (dir==='LONG' ? up : dn);
    } else { // RANGE_FADE
      const hl = hiLoAt(i,20);
      const inRange = (hl[0]!==null) && c>=hl[1] && c<=hl[0];
      trig = (adx!==null && adx<20) && inRange && (dir==='LONG' ? (!up && !dn && rsi<35) : (!up && !dn && rsi>65));
    }
    if(!trig) continue;
    const hl = hiLoAt(i,20); if(hl[0]===null) continue;
    let entry, stop;
    if(dir==='LONG'){
      entry = fam==='TREND_CONTINUATION' ? Math.min(c, sma20) : c;
      stop  = fam==='TREND_CONTINUATION' ? Math.min(hl[1], entry-atr) - atr*0.25 : hl[1] - atr*0.25;
    } else {
      entry = fam==='TREND_CONTINUATION' ? Math.max(c, sma20) : c;
      stop  = fam==='TREND_CONTINUATION' ? Math.max(hl[0], entry+atr) + atr*0.25 : hl[0] + atr*0.25;
    }
    const R = Math.abs(entry - stop); if(!(R>0)) continue;
    const entryExec = dir==='LONG' ? entry*(1+SLIP) : entry*(1-SLIP);
    const Rk = function(m){ return dir==='LONG' ? entry + R*m : entry - R*m; };
    open = { i: i, entry: entryExec, stop: stop, tps: [Rk(1.5), Rk(2.5), Rk(4)], tp_hit: [false,false,false] };
  }
}
function stats(rawTr){
  const tr = rawTr.filter(function(t){ return t.R !== null; });
  const n = tr.length;
  if(!n) return {trades:0,win_rate:0,avg_R:0,expectancy_R:0,profit_factor:0,sharpe:0,max_drawdown_pct:0,tp1_hit_rate:0,tp2_hit_rate:0,tp3_hit_rate:0,notes:'no-sampled-trades'};
  const Rs = tr.map(function(t){ return t.R; });
  let sum = 0, wins = 0, gp = 0, gl = 0;
  for(const r of Rs){ sum += r; if(r > 0){ wins++; gp += r; } else gl -= r; }
  const mean = sum / n;
  let sd = 0; for(const r of Rs) sd += (r-mean)*(r-mean); sd = Math.sqrt(sd/n) || 1e-9;
  let peak = 0, eq = 0, mdd = 0;
  for(const r of Rs){ eq += r; if(eq > peak) peak = eq; const dd = peak - eq; if(dd > mdd) mdd = dd; }
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
    notes: 'deterministic-replay|stop-first-intrabar|fees5bps+slip2bps|1d-multi-instance|no-lookahead|time-stop-'+TIME_STOP_BARS+'bars'
  };
}
const bt = stats(trades);
return [{ json: { backtest: bt, backtest_trades: trades.slice(-60),
  backtest_meta: { candles: K.length, symbol: S.symbol || 'BTCUSDT', engine: 'v3-multi-instance-1d', time_stop_bars: TIME_STOP_BARS, fees_bps_per_side: 5, slip_bps: 2, note: 'no-lookahead: per-instance levels from data<=entry-bar' },
  signal_echo: S, regime_echo: OUT.regime || null,
  confluence_passed: q.confluence_passed || 0, regime_score: q.regime_score || 0,
  decision_echo: 'TRADE' } }];
