// QUANT ENGINE v2 MULTI — evaluates BTC + ETH + SOL + BNB, picks the single best setup.
// Input: Compute v2 output {features_multi{SYM:feat}, funds_multi{SYM:fund}, ticker, fear_greed, btc_dominance, mcap_chg24}.
// Scoring per symbol: confluences passed (need >=6 of 8) + confidence; pick highest confidence,
// tie-break: higher confluence count, then larger |distance to SMA20|/ATR (cleaner pullback).
// Output shape identical to v1: {output:{decision,signal(symbol set!),regime,confluences of WINNER,backtest_est}, quant_meta}
// Regime uses BTC features (unchanged).
const src = $input.first().json;
const FM = src.features_multi || { BTCUSDT: src.features };
const FUNDS = src.funds_multi || { BTCUSDT: src.funding };
const T = src.ticker || [];
const FG = (src.fear_greed === null || src.fear_greed === undefined) ? 50 : src.fear_greed;
const DOM = src.btc_dominance || 0;
const SYMS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'];
const F0 = FM['BTCUSDT'] || {};
if(!F0 || F0.sma20 === null || F0.sma20 === undefined || F0.rsi14 === null || F0.rsi14 === undefined){
  return [{ json: { output: { decision: 'NO_TRADE', no_trade_reason: 'missing-indicators: BTC features null; cannot score regime.', signal: { symbol:'NONE',direction:'NEUTRAL',setup_family:'',entry_zone:[0,0],stop_loss:0,tp1:0,tp2:0,tp3:0,confidence_0_100:0,time_stop_1h_candles:0,invalidation:'',scenario_pair:{base_path:'',invalidation_path_second_order:''}}, backtest_est: { trades:0,expectancy_R:null,profit_factor:null,tp1_hit_rate:null,tp2_hit_rate:null,must_validate:true }, regime: { score:0,zone:'NEUTRAL',drivers:[] }, confluences: [] }, quant_meta: { engine:'quant-v2-multi', at:new Date().toISOString() } } }];
}
// regime (BTC-based, same weights as v1)
function regimeScore(){
  const lastC = (F0.closes && F0.closes.length) ? F0.closes[F0.closes.length-1] : null;
  let btcTrend = 50;
  if(lastC && F0.sma50 && F0.sma200){
    if(lastC > F0.sma50 && F0.sma50 > F0.sma200) btcTrend = 100;
    else if(lastC > F0.sma200) btcTrend = 60;
    else if(lastC > F0.sma50) btcTrend = 40;
    else btcTrend = 10;
  }
  let pos=0, tot=0;
  for(const t of T){ const c=parseFloat(t.priceChangePercent); if(!isNaN(c)){ tot++; if(c>0) pos++; } }
  const breadth = tot ? Math.round(pos/tot*100) : 50;
  let domScore = 50;
  if(DOM >= 55 && lastC && F0.sma200 && lastC > F0.sma200) domScore = 60;
  else if(DOM >= 60) domScore = 30;
  else if(DOM < 50) domScore = 65;
  const f0 = (FUNDS['BTCUSDT'] && parseFloat(FUNDS['BTCUSDT'].lastFundingRate)) || 0;
  let fundScore = 80;
  if(Math.abs(f0) > 0.0005) fundScore = 30;
  else if(Math.abs(f0) > 0.0002) fundScore = 60;
  let dvScore = 60;
  if(F0.bb && F0.bb.pos === 'above-upper') dvScore = 35;
  else if(F0.bb && F0.bb.pos === 'below-lower') dvScore = 40;
  if(F0.atr_pct && F0.atr_pct > 3) dvScore = Math.min(dvScore, 40);
  let momScore = 50;
  if(F0.chg7 !== null && F0.chg7 !== undefined){ momScore = F0.chg7 > 5 ? 85 : (F0.chg7 > 0 ? 60 : (F0.chg7 > -5 ? 40 : 15)); }
  const score = Math.round(btcTrend*0.25 + breadth*0.20 + domScore*0.15 + fundScore*0.15 + dvScore*0.15 + momScore*0.10);
  return { score: score, zone: score >= 80 ? 'RISK_ON' : (score >= 40 ? 'NEUTRAL' : 'RISK_OFF'),
    drivers: ['btcTrend='+btcTrend,'breadth='+breadth+'%','dom='+DOM,'fund='+f0,'chg7='+F0.chg7], momScore: momScore };
}
const REG = regimeScore();
const comp = Math.round(FG*0.4 + 50*0.4 + REG.momScore*0.2);
function evalSym(sym){
  const F = FM[sym];
  if(!F || F.error || F.sma20 === null || F.sma20 === undefined || F.rsi14 === null || F.rsi14 === undefined)
    return { sym: sym, ok: false, reason: 'missing-features' };
  const fund = (FUNDS[sym] && parseFloat(FUNDS[sym].lastFundingRate)) || 0;
  const lastC = F.closes[F.closes.length-1];
  const rsi = F.rsi14, sma20 = F.sma20, sma50 = F.sma50, atr = F.atr14;
  const uptrend = lastC && sma20 && sma50 && lastC > sma20 && sma20 > sma50;
  const downtrend = lastC && sma20 && sma50 && lastC < sma20 && sma20 < sma50;
  const rsiSane = rsi !== null && rsi < 78 && rsi > 22;
  const bbSane = !(F.bb && (F.bb.pos === 'above-upper' || F.bb.pos === 'below-lower'));
  let dir = null, family = '';
  const pullLong = uptrend && rsi < 60 && rsi > 40;
  const pullShort = downtrend && rsi < 60 && rsi > 40;
  const rLong = rsiSane && bbSane && !uptrend && !downtrend && F.bb && F.bb.pos === 'lower-half' && rsi < 35;
  const rShort = rsiSane && bbSane && !uptrend && !downtrend && F.bb && F.bb.pos === 'upper-half' && rsi > 65;
  const adxOk = F.adx14 !== null && F.adx14 !== undefined;
  const adxV = adxOk ? F.adx14 : null;
  const trendAdxOk = adxOk && adxV >= 20;
  const rangeAdxOk = adxOk && adxV < 20;
  if(pullLong && trendAdxOk){ dir='LONG'; family='TREND_CONTINUATION'; }
  else if(pullShort && trendAdxOk){ dir='SHORT'; family='TREND_CONTINUATION'; }
  else if(rLong && rangeAdxOk){ dir='LONG'; family='RANGE_FADE'; }
  else if(rShort && rangeAdxOk){ dir='SHORT'; family='RANGE_FADE'; }
  const C = [];
  function c(n,ok,d){ C.push({name:n,pass:!!ok,detail:d||''}); }
  c('regime-not-risk-off', REG.zone !== 'RISK_OFF', REG.zone);
  c('sentiment-no-veto', dir ? !((dir==='LONG'&&comp>=81)||(dir==='SHORT'&&comp<=20)) : true, 'composite='+comp);
  c('trend-stack', !!(uptrend||downtrend)||family==='RANGE_FADE', uptrend?'up':(downtrend?'down':'range'));
  c('rsi-not-extreme', rsiSane, 'rsi='+(rsi!==null?rsi.toFixed(1):'?'));
  c('bollinger-not-extended', bbSane, F.bb?F.bb.pos:'?');
  c('volume-ok', F.relvol===null||F.relvol>0.7, 'relvol='+F.relvol);
  c('funding-sane', Math.abs(fund)<=0.0005, 'fund='+fund);
  c('setup-present', !!dir, family||'none');
  c('adx-regime-fit', dir ? (family==='TREND_CONTINUATION' ? trendAdxOk : rangeAdxOk) : (adxOk && adxV>=20), 'adx='+(adxV!==null?adxV:'?'));
  const passed = C.filter(function(x){return x.pass;}).length;
  if(!dir) return { sym: sym, ok: false, reason: 'no-setup', conf: C, passed: passed, F: F };
  const hi20=F.high20, lo20=F.low20;
  let entry, stop;
  if(dir==='LONG'){ entry=Math.min(lastC,sma20); stop=Math.min(lo20,entry-atr*1.0)-atr*0.25; }
  else { entry=Math.max(lastC,sma20); stop=Math.max(hi20,entry+atr*1.0)+atr*0.25; }
  const R=Math.abs(entry-stop);
  if(!(R>0)) return { sym: sym, ok:false, reason:'degenerate', conf:C, passed:passed, F:F };
  const tax = dir==='LONG' ? ((comp>=61&&comp<=80)?5:0) : ((comp>=21&&comp<=40)?5:0);
  let cfd = 70 + Math.min(12,passed) - tax;
  if(REG.zone==='RISK_OFF') cfd -= 10;
  cfd = Math.max(0,Math.min(100,Math.round(cfd)));
  const mid=entry;
  function rr(m){ return dir==='LONG'?mid+R*m:mid-R*m; }
  const pullQ = atr>0 ? Math.abs(lastC-sma20)/atr : 0;
  return { sym: sym, ok: true, dir: dir, family: family, conf: cfd, passed: passed, C: C, F: F,
    signal: { symbol: sym, direction: dir, setup_family: family,
      entry_zone: [Math.round((mid-atr*0.25)*100)/100, Math.round((mid+atr*0.25)*100)/100],
      stop_loss: Math.round(stop*100)/100, tp1: Math.round(rr(1.5)*100)/100, tp2: Math.round(rr(2.5)*100)/100, tp3: Math.round(rr(4)*100)/100,
      confidence_0_100: cfd, time_stop_1h_candles: 24,
      invalidation: family==='TREND_CONTINUATION' ? ('4H close beyond stop ('+(Math.round(stop*100)/100)+') or loss of SMA50 structure.') : '4H close outside range edge; range invalid.',
      scenario_pair: { base_path: dir+' holds value, TP1 1.5R first.', invalidation_path_second_order: 'If BTC breaks down, alt bid evaporates; stand down.' } },
    pullQ: pullQ };
}
const results = SYMS.map(evalSym);
const cands = results.filter(function(r){ return r.ok && r.conf >= 75 && r.passed >= 6; });
cands.sort(function(a,b){ return (b.conf-a.conf) || (b.passed-a.passed) || (b.pullQ-a.pullQ); });
function blankSig(){ return { symbol:'NONE',direction:'NEUTRAL',setup_family:'',entry_zone:[0,0],stop_loss:0,tp1:0,tp2:0,tp3:0,confidence_0_100:0,time_stop_1h_candles:0,invalidation:'',scenario_pair:{base_path:'',invalidation_path_second_order:''}}; }
if(!cands.length){
  const det = results.map(function(r){ return r.sym+':'+(r.ok?('conf='+r.conf+'/pass='+r.passed):r.reason); }).join(' | ');
  return [{ json: { output: { decision:'NO_TRADE', no_trade_reason:'no-qualifier-4sym: '+det, signal:blankSig(),
    backtest_est:{trades:0,expectancy_R:null,profit_factor:null,tp1_hit_rate:null,tp2_hit_rate:null,must_validate:true},
    regime:{score:REG.score,zone:REG.zone,drivers:REG.drivers}, confluences:(results[0]&&results[0].conf)||[] },
    quant_meta:{engine:'quant-v2-multi',at:new Date().toISOString()} } }];
}
const W = cands[0];
return [{ json: { output: { decision:'TRADE', no_trade_reason:'', signal:W.signal,
  backtest_est:{trades:0,expectancy_R:null,profit_factor:null,tp1_hit_rate:null,tp2_hit_rate:null,must_validate:true},
  regime:{score:REG.score,zone:REG.zone,drivers:REG.drivers}, confluences:W.C,
  ranked: results.map(function(r){ return {sym:r.sym, ok:r.ok, conf:(r.conf||0), passed:(r.passed||0)}; }) },
  quant_meta:{engine:'quant-v2-multi',at:new Date().toISOString(),winner:W.sym}, confluence_passed:W.passed, regime_score:REG.score } }];
