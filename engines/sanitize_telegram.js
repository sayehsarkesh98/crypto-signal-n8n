
const t = $input.first().json;
let s = String(t.text || '');
s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500);
return [{ json: { chat_id: '6643216800', text: s } }];
