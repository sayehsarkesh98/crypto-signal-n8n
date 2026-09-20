// Tracker: input = open ledger rows (DataTable get). For each row: decide outcome using
// ALL tickers from Fetch Ticker. (Fix 2026-09-20: the HTTP node splits the 4-symbol array
// response into separate items, so $('Fetch Ticker').first() saw only BTCUSDT — ETH/SOL/BNB
// rows stayed OPEN forever. Now all items are flattened before per-row matching.)
const rows = $input.all().map(function(i){ return i.json; });
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
  const stopHit = dir === 'LONG' ? px <= sl : px >= sl;
  const tp1Hit = dir === 'LONG' ? px >= tp1 : px <= tp1;
  const R = Math.abs(r.entry_mid - sl);
  let patch = null;
  if(stopHit){
    patch = { status: 'STOP', exit_price: sl, outcome_R: -1 + (dir==='LONG'? -0.0007*(r.entry_mid):0)*0, closed_at: new Date().toISOString() };
  } else if(tp1Hit){
    patch = { status: 'TP1', exit_price: tp1, outcome_R: R>0 ? 1.5 - 0.001 : 0, closed_at: new Date().toISOString() };
  }
  if(patch){ out.push({ json: { id: r.id, symbol: sym, patch: patch } }); }
}
return out.length ? out : [];
