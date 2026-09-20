const fs = require('fs');
const code = fs.readFileSync(__dirname + '/evaluate_outcomes.js', 'utf8');
const fetched = [
  { json: { symbol: 'ETHUSDT', lastPrice: '2500' } },
  { json: { symbol: 'BTCUSDT', lastPrice: '100000' } },
  { json: { symbol: 'SOLUSDT', lastPrice: '110' } },
  { json: { symbol: 'BNBUSDT', lastPrice: '600' } },
];
const rows = [
  { json: { id: 1, symbol: 'ETHUSDT', direction: 'LONG', entry_mid: 2400, stop_loss: 2300, tp1: 2600, status: 'OPEN' } },
  { json: { id: 2, symbol: 'SOLUSDT', direction: 'LONG', entry_mid: 95, stop_loss: 90, tp1: 105, status: 'OPEN' } },
  { json: { id: 3, symbol: 'BNBUSDT', direction: 'LONG', entry_mid: 650, stop_loss: 640, tp1: 700, status: 'OPEN' } },
  { json: { id: 4, symbol: 'ETHUSDT', direction: 'LONG', entry_mid: 2400, stop_loss: 2300, tp1: 2600, status: 'TP1' } },
];
const $input = { all: () => rows };
const $ = { Fetch: { Ticker: { all: () => fetched } } };
global.$input = $input;
global.$ = (name) => { if (name === 'Fetch Ticker') return $.Fetch.Ticker; throw new Error('no node ' + name); };
const fn = new Function('$input', '$', code);
const res = fn($input, (name) => { if (name === 'Fetch Ticker') return { all: () => fetched }; throw new Error("no node " + name); });
console.log(JSON.stringify(res, null, 1));
const ids = res.map(r => r.json.id);
console.log('ASSERT count=2:', res.length === 2);
console.log('ASSERT SOL=TP1:', res.some(r => r.json.id === 2 && r.json.patch.status === 'TP1'));
console.log('ASSERT BNB=STOP:', res.some(r => r.json.id === 3 && r.json.patch.status === 'STOP'));
console.log('ASSERT ETH no-patch:', !ids.includes(1), 'ASSERT closed-row skipped:', !ids.includes(4));
