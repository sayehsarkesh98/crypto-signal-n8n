// Log NO_TRADE v3 — two input shapes:
// 1) Quant output passthrough (Is TRADE? FALSE branch): {output, quant_meta}.
// 2) Gate-failed item (Gates Pass? FALSE branch): {backtest, signal_echo, gate_check, ...}.
const q = $input.first().json;
if(q.gate_check){
  const b = q.backtest || {};
  const btStr = 'bt: trades=' + (b.trades||0) + ' exp=' + (b.expectancy_R===null?'-':b.expectancy_R) + 'R pf=' + (b.profit_factor===null?'-':b.profit_factor);
  return [{ json: { decision: 'NO_TRADE', reason: 'gate-failed: ' + (q.gate_check.failed_gates||[]).join(', ') + ' | ' + btStr, at: new Date().toISOString(),
    signal: q.signal_echo || {}, regime: q.regime_echo || null, confluences: [], quant_meta: null } }];
}
const o = q.output || q;
return [{ json: { decision: 'NO_TRADE', reason: o.no_trade_reason || 'filtered', at: new Date().toISOString(),
  signal: o.signal || {}, regime: o.regime || null, confluences: o.confluences || [], quant_meta: q.quant_meta || null } }];
