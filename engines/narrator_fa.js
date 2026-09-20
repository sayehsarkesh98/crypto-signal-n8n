// NARRATOR v3 — three-way dispatch: TRADE / gate-failed / NO_TRADE.
// TRADE branch: direct input is the Ledger Insert row (inserted columns only). The
// full context comes from the cross-node read of Validate Gates — which since the
// 2026-09-20 rewire sits AFTER Backtest Engine and carries {backtest, signal_echo,
// gate_check, confluence_passed, regime_score, regime_echo} in one item.
// gate_check.passed === false → NO_TRADE message WITH the real backtest numbers and
// the failed gate list (gates are blocking now; hiding a rejection would be a lie).
// Quant NO_TRADE branch: Validate Gates never ran → cross-node read throws → fall
// back to $input (Log NO_TRADE echo of the Quant output).
const cur0 = $input.first().json;
let cur = cur0;
try {
  const vg = $('Validate Gates').first().json;
  if (vg && vg.backtest) cur = vg;
} catch (e) { /* branch without Validate Gates */ }
function n(x, d){ return (x === null || x === undefined || x === '') ? d : x; }
let decision, reason, s, bReal;
if(cur.backtest && cur.gate_check){
  s = cur.signal_echo || {};
  bReal = cur.backtest;
  if(cur.gate_check.passed){ decision = 'TRADE'; reason = ''; }
  else { decision = 'NO_TRADE'; reason = 'gate-failed: ' + ((cur.gate_check.failed_gates || []).join(', ')); }
} else if(cur.backtest && cur.signal_echo){
  decision = 'TRADE'; s = cur.signal_echo || {}; bReal = cur.backtest; reason = '';
} else if(cur.output && cur.output.decision){
  decision = cur.output.decision; reason = cur.output.no_trade_reason || '';
  s = cur.output.signal || {}; bReal = null;
} else {
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
