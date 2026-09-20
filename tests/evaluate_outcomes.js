// Tracker v3: all-symbol matching (v2 fix) + TIME_STOP enforcement.
// Signal gives time_stop_1h_candles=24 → 24 HOURS; ledger rows older than that with
// neither STOP nor TP1 hit now close as TIME_STOP with the signed R of the live price.
// (Prevents rows stuck OPEN forever from closing months later on a stale stop.)
const rowsAll = $input.all().map(function(i){ return i.json; });
// Ledger Get OPEN runs once per incoming Fetch Ticker item (HTTP node splits the
// 4-symbol array into 4 items), so rows arrive duplicated — dedupe by row id.
const seen = {};
const rows = [];
for (const r of rowsAll) {
  if (r.status && r.status !== 'OPEN') continue;
  const k = String(r.id);
  if (seen[k]) continue;
  seen[k] = 1;
  rows.push(r);
}
let tarr = [];
try {
  for(const t of $('Fetch Ticker').all().map(function(i){ return i.json; })){
    if(Array.isArray(t)) tarr = tarr.concat(t);
    else if(t && t.symbol) tarr.push(t);
    else if(t && Array.isArray(t.json)) tarr = tarr.concat(t.json);
  }
} catch(e) { tarr = []; }
const out = [];
for(const r of rows){
  if(r.status && r.status !== 'OPEN') continue;
  const sym = r.symbol;
  let px = null;
  const hit = tarr.filter(function(x){ return x && x.symbol === sym; })[0];
  if(hit){ const p = parseFloat(hit.lastPrice); if(!isNaN(p)) px = p; }
  if(px === null) continue;
  const dir = r.direction;
  const tp1 = r.tp1, sl = r.stop_loss;
  const R = Math.abs(r.entry_mid - sl);
  const stopHit = dir === 'LONG' ? px <= sl : px >= sl;
  const tp1Hit = dir === 'LONG' ? px >= tp1 : px <= tp1;
  const created = r.created_at ? new Date(r.created_at).getTime() : null;
  const ageH = created ? (Date.now() - created) / 3600000 : null;
  const tsH = (r.time_stop && r.time_stop > 0) ? r.time_stop : 24; // hours = 24 x 1H candles
  let patch = null;
  if(stopHit){
    patch = { status: 'STOP', exit_price: sl, outcome_R: R > 0 ? -1 : 0, closed_at: new Date().toISOString() };
  } else if(tp1Hit){
    patch = { status: 'TP1', exit_price: tp1, outcome_R: R > 0 ? 1.5 - 0.001 : 0, closed_at: new Date().toISOString() };
  } else if(ageH !== null && ageH >= tsH){
    const rNow = R > 0 ? (dir === 'LONG' ? (px - r.entry_mid) / R : (r.entry_mid - px) / R) : 0;
    patch = { status: 'TIME_STOP', exit_price: px, outcome_R: Math.round(rNow*1000)/1000, closed_at: new Date().toISOString() };
  }
  if(patch){ out.push({ json: { id: r.id, symbol: sym, patch: patch } }); }
}
return out.length ? out : [];
