const fs = require('fs');
const code = fs.readFileSync(__dirname + '/evaluate_outcomes.js', 'utf8');
const now = Date.now();
const fetched = [
  { json: { symbol: 'ETHUSDT', lastPrice: '2500' } },
  { json: { symbol: 'BTCUSDT', lastPrice: '100000' } },
  { json: { symbol: 'SOLUSDT', lastPrice: '95' } },
  { json: { symbol: 'BNBUSDT', lastPrice: '600' } },
  { json: { symbol: 'XRPUSDT', lastPrice: '295' } },
  { json: { symbol: 'ADAUSDT', lastPrice: '315' } },
];
const H = 3600000;
const rows = [
  { json: { id: 1, symbol: 'ETHUSDT', direction: 'LONG', entry_mid: 2400, stop_loss: 2300, tp1: 2600, status: 'OPEN', created_at: new Date(now - 1*H).toISOString() } },
  { json: { id: 2, symbol: 'SOLUSDT', direction: 'LONG', entry_mid: 95, stop_loss: 90, tp1: 105, status: 'OPEN', created_at: new Date(now - 30*H).toISOString() } },
  { json: { id: 3, symbol: 'BNBUSDT', direction: 'LONG', entry_mid: 650, stop_loss: 640, tp1: 700, status: 'OPEN', created_at: new Date(now - 30*H).toISOString() } },
  { json: { id: 4, symbol: 'BTCUSDT', direction: 'LONG', entry_mid: 2400, stop_loss: 2300, tp1: 2600, status: 'TP1', created_at: new Date(now - 30*H).toISOString() } },
  { json: { id: 5, symbol: 'XRPUSDT', direction: 'SHORT', entry_mid: 300, stop_loss: 310, tp1: 270, status: 'OPEN', created_at: new Date(now - 30*H).toISOString() } },
  { json: { id: 6, symbol: 'ADAUSDT', direction: 'SHORT', entry_mid: 300, stop_loss: 320, tp1: 280, status: 'OPEN', created_at: new Date(now - 30*H).toISOString() } },
];
const $input = { all: () => rows };
const $ = (name) => { if (name === 'Fetch Ticker') return { all: () => fetched }; throw new Error('no node ' + name); };
const res = new Function('$input', '$', code)($input, $);
const byId = {}; res.forEach(r => byId[r.json.id] = r.json);
console.log(JSON.stringify(res.map(r => r.json.id) + ':' + res.map(r => r.json.patch.status)));
console.log('ASSERT id1 fresh flat → no patch:', !(1 in byId));
console.log('ASSERT id2 stale flat → TIME_STOP R=0:', byId[2] && byId[2].patch.status === 'TIME_STOP' && byId[2].patch.outcome_R === 0);
console.log('ASSERT id3 stale below stop → STOP wins over TIME_STOP:', byId[3] && byId[3].patch.status === 'STOP' && byId[3].patch.outcome_R === -1);
console.log('ASSERT id4 closed → untouched:', !(4 in byId));
console.log('ASSERT id5 SHORT stale in-range → TIME_STOP R=+0.5:', byId[5] && byId[5].patch.status === 'TIME_STOP' && byId[5].patch.outcome_R === 0.5);
console.log('ASSERT id6 SHORT stale above entry → TIME_STOP R=-0.75:', byId[6] && byId[6].patch.status === 'TIME_STOP' && byId[6].patch.outcome_R === -0.75);
