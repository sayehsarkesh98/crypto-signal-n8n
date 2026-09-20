// Log NO_TRADE v2 — echoes the FULL Quant output (not just reason) so Narrator has everything.
const q = $input.first().json; // Quant Engine output {output, quant_meta} passed through Is TRADE? FALSE branch
const o = q.output || q;
return [{ json: { decision: 'NO_TRADE', reason: o.no_trade_reason || 'filtered', at: new Date().toISOString(),
  signal: o.signal || {}, regime: o.regime || null, confluences: o.confluences || [], quant_meta: q.quant_meta || null } }];
