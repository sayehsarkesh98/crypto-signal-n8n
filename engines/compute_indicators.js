// Compute Indicators v2 MULTI — BTC + ETH + SOL + BNB.
// Merge-append delivers candles as SEPARATE ITEMS. Each kline item is an array.
// Tagging: HTTP nodes now wrap candles as {symbol, candles:[...]}? No — n8n HTTP returns
// raw array items. To tag per-symbol we rely on ORDER: Merge appends input0..input4 in order,
// but klines of 4 symbols interleave. ROBUST FIX: separate HTTP nodes per symbol, each into
// its own Merge input is NOT possible (merge has 5 inputs, klines need 4).
// CHOSEN DESIGN: ONE HTTP node per symbol pair? Simplest reliable: keep Merge for
// ticker/funding/fng/cg (unchanged), and fetch the 4 kline sets with FOUR HTTP nodes
// chained Compute-side via $() reads. n8n $() can read other nodes' outputs:
//   $('Fetch ETH Klins').all() etc. This avoids merge-order fragility entirely.
function ind(klines){
  function sma(a,n){ if(!a || a.length<n) return null; let s=0; for(let i=a.length-n;i<a.length;i++) s+=a[i]; return s/n; }
  function ema(a,n){ if(!a || !a.length) return null; const k=2/(n+1); let e=a[0]; for(let i=1;i<a.length;i++) e=a[i]*k+e*(1-k); return e; }
  function rsi(cl,n){ if(!cl || cl.length<n+1) return null; let g=0,l=0; for(let i=cl.length-n;i<cl.length;i++){ const c=cl[i]-cl[i-1]; if(c>0) g+=c; else l-=c; } if(l===0) return 100; return 100-100/(1+(g/n)/(l/n)); }
  function atr(h,l,c,n){ if(!c || c.length<n+1) return null; const trs=[]; for(let i=c.length-n;i<c.length;i++){ trs.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1]))); } let s=0; for(const v of trs) s+=v; return s/trs.length; }
  function stoch(cl,hi,lo,kp,kd){ if(!cl || cl.length<kp+kd) return null; const ks=[]; for(let i=kp-1;i<cl.length;i++){ const hh=Math.max.apply(null,hi.slice(i-kp+1,i+1)); const ll=Math.min.apply(null,lo.slice(i-kp+1,i+1)); ks.push(hh===ll?50:(cl[i]-ll)/(hh-ll)*100); } const k=ks[ks.length-1]; const d=(ks[ks.length-1]+ks[ks.length-2]+ks[ks.length-3])/3; return {k:k, d:d}; }
  function adx(h,l,c,n){ if(!c || c.length < n*2+2) return null; let plus=0,minus=0,tr=0;
 for(let i=c.length-n*2+1;i<c.length;i++){ const up=h[i]-h[i-1], dn=l[i-1]-l[i]; let x=Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])); tr+=x; plus+= (up>dn&&up>0)?up:0; minus+= (dn>up&&dn>0)?dn:0; }
 const di_p=tr>0?100*plus/tr:0, di_m=tr>0?100*minus/tr:0; const sum=di_p+di_m; return sum>0?Math.round(100*Math.abs(di_p-di_m)/sum):0; }
function macd(a){ if(!a || a.length<35) return null; function e(v,n){ const k=2/(n+1); let x=v[0]; for(let i=1;i<v.length;i++) x=v[i]*k+x*(1-k); return x; } const line=e(a.slice(-60),12)-e(a.slice(-60),26); return {line:line, hist_dir:'see-1h-trigger'}; }
  // normalize: array of candle-arrays OR array of items
  let K = klines;
  if(!Array.isArray(K)) return { error: 'not-array', closes: [] };
  if(K.length && !Array.isArray(K[0]) && K[0].json) K = K.map(function(i){ return i.json; });
  K = K.filter(function(x){ return Array.isArray(x); });
  if(!K.length) return { error: 'no-candles', closes: [] };
  K.sort(function(a,b){ return a[0]-b[0]; });
  const cl=K.map(function(r){ return parseFloat(r[4]); });
  const hi=K.map(function(r){ return parseFloat(r[2]); });
  const lo=K.map(function(r){ return parseFloat(r[3]); });
  const vo=K.map(function(r){ return parseFloat(r[5]); });
  const o={ closes: cl.slice(-5), sma20: sma(cl,20), sma50: sma(cl,50), sma200: cl.length>=200?sma(cl,200):null,
    ema12: ema(cl,12), ema26: ema(cl,26), rsi14: rsi(cl,14), atr14: atr(hi,lo,cl,14), stoch: stoch(cl,hi,lo,14,3), macd: macd(cl), adx14: adx(hi,lo,cl,14),
    high20: null, low20: null, relvol: null, chg7: null, chg30: null, bb: null, atr_pct: null, count: cl.length };
  if(o.atr14 && cl.length) o.atr_pct = o.atr14/cl[cl.length-1]*100;
  if(cl.length>=20){ const basis=sma(cl,20); let sd=0; const w=cl.slice(-20); for(const v of w) sd+=(v-basis)*(v-basis); sd=Math.sqrt(sd/20); o.bb={mid:basis, upper:basis+2*sd, lower:basis-2*sd, pos: cl[cl.length-1]>basis+2*sd?'above-upper':(cl[cl.length-1]<basis-2*sd?'below-lower':(cl[cl.length-1]>basis?'upper-half':'lower-half'))}; }
  if(hi.length>=20){ o.high20=Math.max.apply(null,hi.slice(-20)); o.low20=Math.min.apply(null,lo.slice(-20)); }
  if(vo.length>=21){ let s=0; for(let i=vo.length-21;i<vo.length-1;i++) s+=vo[i]; const avg=s/20; o.relvol=avg>0?vo[vo.length-1]/avg:null; }
  if(cl.length>=8) o.chg7=(cl[cl.length-1]/cl[cl.length-8]-1)*100;
  if(cl.length>=31) o.chg30=(cl[cl.length-1]/cl[cl.length-31]-1)*100;
  o.computed_at = new Date().toISOString();
  return o;
}
function grab(name){
  try {
    const items = $(name).all().map(function(i){ return i.json; });
    // HTTP klines node: items are candle arrays (or single array)
    if(items.length === 1 && Array.isArray(items[0]) && items[0].length && Array.isArray(items[0][0])) return items[0];
    return items;
  } catch(e){ return { error: String(e).slice(0,120) }; }
}
// merge passthrough data (ticker/funding/fng/cg) from $input as before
const items = $input.all().map(function(i){ return i.json; });
let ticker=[], funding=null, fng=null, cg=null;
for(const d of items){
  if(Array.isArray(d)) continue; // klines no longer come via merge
  if(d && d.symbol && d.lastPrice){ ticker.push(d); continue; }
  if(d && d.markPrice && d.lastFundingRate && !funding){ funding=d; continue; }
  if(d && d.data && d.data.market_cap_percentage){ cg=d; continue; }
  if(d && ((d.data && Array.isArray(d.data)) || d.name==='Fear and Greed Index')){ fng=d; continue; }
}
const symbols = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'];
const nodeMap = { BTCUSDT: 'Fetch 4H Klines Batch', ETHUSDT: 'Fetch ETH Klines', SOLUSDT: 'Fetch SOL Klines', BNBUSDT: 'Fetch BNB Klines' };
const feats = {};
for(const s of symbols){ feats[s] = ind(grab(nodeMap[s])); }
// funding per symbol
function grabFund(sym){
  try {
    const j = $('Fetch Funding ' + sym.replace('USDT','')).first().json;
    return j;
  } catch(e){ return null; }
}
const funds = { BTCUSDT: funding };
for(const s of ['ETHUSDT','SOLUSDT','BNBUSDT']){ const f = grabFund(s); if(f) funds[s] = f; }
let fngNow=null, fng7=[];
try{ const src=fng.data||fng; const arr=src.data||src; if(Array.isArray(arr)){ fngNow=parseFloat(arr[0].value); fng7=arr.map(function(x){ return parseFloat(x.value); }); } }catch(e){}
let dom=null, mcapChg=null;
try{ dom=cg.data.market_cap_percentage.btc; mcapChg=cg.data.market_cap_change_percentage_24h_usd; }catch(e){}
// keep legacy single-symbol fields (BTC) so old consumers don't break
return [{ json: { ticker: ticker, funding: funding, fear_greed: fngNow, fear_greed_7d: fng7,
  btc_dominance: dom, mcap_chg24: mcapChg, features: feats['BTCUSDT'],
  features_multi: feats, funds_multi: funds } }];
