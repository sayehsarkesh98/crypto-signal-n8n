// NARRATOR v2 — pure $input reader (no $() cross-node reads, safe on both branches).
// TRUE branch input: Backtest Engine output {backtest, backtest_trades, backtest_meta} — but signal lives in Validate Gates...
// Fix: Validate Gates passes signal THROUGH Fetch 1D History? No — HTTP node drops it.
// So Backtest Engine output lacks signal. Solution: Backtest Engine INCLUDES signal echo.
// (patched below: Backtest Engine returns {json:{backtest, backtest_trades, backtest_meta, signal_echo}})
// FALSE branch input: Log NO_TRADE output {decision, reason, at} — but quant reason lives in Is TRADE? input...
// Fix: Is TRADE? passes Quant output through; Log NO_TRADE must ECHO full quant output. (patched below)
const cur0 = $input.first().json;
// TRADE branch: direct input is the Ledger Insert row (columns+id only, no backtest).
// Prefer the Backtest Engine output (backtest + signal_echo + regime_echo) via cross-node
// read; on the NO_TRADE branch Backtest Engine never ran, the read throws, keep $input.
let cur = cur0;
try {
  const bt = $('Backtest Engine').first().json;
  if (bt && bt.backtest) cur = bt;
} catch (e) { /* branch without Backtest Engine */ }
function n(x, d){ return (x === null || x === undefined || x === '') ? d : x; }
let decision, reason, s, bReal;
if(cur.backtest && cur.signal_echo){
  // TRADE branch
  decision = 'TRADE'; s = cur.signal_echo || {}; bReal = cur.backtest;
  reason = '';
} else if(cur.output && cur.output.decision){
  // fallback: quant-shaped passthrough
  decision = cur.output.decision; reason = cur.output.no_trade_reason || '';
  s = cur.output.signal || {}; bReal = null;
} else {
  // NO_TRADE branch: Log NO_TRADE echoed full quant output?
  decision = cur.decision || 'NO_TRADE';
  reason = cur.reason || cur.no_trade_reason || '';
  s = cur.signal || {};
  bReal = null;
}
function faDir(d){ if(d === 'LONG') return 'خرید (لانگ)'; if(d === 'SHORT') return 'فروش (شورت)'; return '—'; }
function faFam(f){ if(f === 'TREND_CONTINUATION') return 'ادامه روند'; if(f === 'RANGE_FADE') return 'برگشت از لبه رنج'; return (f || '—'); }
const L = [];
if(decision === 'TRADE'){
  L.push('✅ سیگنال کریپتو — معامله');
  L.push('ارز: ' + (s.symbol || '؟') + ' | جهت: ' + faDir(s.direction) + ' | ستاپ: ' + faFam(s.setup_family));
  L.push('اطمینان موتور: ' + n(s.confidence_0_100, 0) + ' از ۱۰۰');
  L.push('ورود: ' + JSON.stringify(s.entry_zone || []) + ' | حد ضرر: ' + n(s.stop_loss, '؟'));
  L.push('تارگت‌ها: ' + n(s.tp1,'؟') + ' / ' + n(s.tp2,'؟') + ' / ' + n(s.tp3,'؟'));
} else {
  L.push('⛔ بدون معامله');
  L.push('دلیل موتور: ' + (reason || 'شرایط لازم برقرار نبود'));
}
if(bReal && bReal.trades){
  L.push('بک‌تست واقعی: تعداد=' + bReal.trades + ' امید=' + bReal.expectancy_R + 'R فاکتور=' + bReal.profit_factor + ' برخورد تارگت۱=' + bReal.tp1_hit_rate + ' تارگت۲=' + bReal.tp2_hit_rate);
  L.push('حداکثر افت: ' + bReal.max_drawdown_pct + 'R');
} else {
  L.push('بک‌تست: در این اجرا معامله‌ای نبود');
}
if(s.invalidation) L.push('ابطال: ' + s.invalidation);
const REG = cur.regime || cur.regime_echo || null;
if(REG && REG.zone) L.push('رژیم: ' + REG.zone + ' (' + REG.score + ')');
L.push('فقط تحلیل است، توصیه مالی نیست');
return [{ json: { chat_id: '6643216800', text: L.join('\n') } }];
