// The Overpainted — playtest collector (Google Apps Script).
// Setup: docs/playtest-setup.md. Paste this file into Extensions → Apps Script of a Google Sheet,
// set the script property READ_KEY, and deploy as a Web app (execute as me, access: anyone).
//
//   POST  body {"session": "...", "events": [...]}   append events (the game does this; no key needed)
//   GET   ?key=READ_KEY[&since=<ms>]                  all events as JSON lines {session, event}
//                                                     (tools/pull-playtests.mjs does this)
const SHEET = 'events';
const MAX_EVENTS = 2000;

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['received', 'session', 't', 'type', 'level', 'event']);
  return sh;
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return text_('bad json'); }
  if (!body || !/^[\w-]{1,64}$/.test(body.session) || !Array.isArray(body.events) || !body.events.length || body.events.length > MAX_EVENTS) {
    return text_('bad payload');
  }
  const now = new Date();
  const rows = body.events.map(ev => [now, body.session, Number(ev.t) || 0, String(ev.type || '').slice(0, 40), String(ev.lvl || '').slice(0, 40), JSON.stringify(ev).slice(0, 40000)]);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return text_('ok');
}

function doGet(e) {
  const key = PropertiesService.getScriptProperties().getProperty('READ_KEY');
  if (!key || !e.parameter || e.parameter.key !== key) return text_('forbidden');
  const since = Number(e.parameter.since || 0);
  const values = sheet_().getDataRange().getValues().slice(1);
  const lines = [];
  for (const r of values) {
    if (Number(r[2]) <= since) continue;
    try { lines.push(JSON.stringify({ session: r[1], event: JSON.parse(r[5]) })); } catch (err) { /* skip a damaged row */ }
  }
  return text_(lines.join('\n'));
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
