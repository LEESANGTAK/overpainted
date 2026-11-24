// UI language. Korean by default; ?lang=en (or the header button) switches and is remembered.
// Level text: a level may carry { ko: { name, note, voice } } next to its English fields.
const KEY = 'overpainted.lang';

const STR = {
  ko: {
    brandSub: '프로토타입', play: '플레이', editor: '에디터', rec: '● 녹화',
    keys: 'Z 되돌리기 · R 처음부터 · H 힌트 · M 소리 · D 개발자',
    soundOn: '소리 켬', soundOff: '소리 끔',
    keysPlay: 'Z 되돌리기 · R 처음부터 · H 힌트 · M 소리',
    keysPad: '십자키 이동 · A 두드리기 · B 되돌리기 · X 도구 (누른 채 십자키로 고르기) · Y 힌트 · View 처음부터 · Menu 소리 · LB/RB 그림',
    padTapForSound: '게임패드가 연결되었습니다. 소리를 들으려면 화면을 한 번 눌러 주세요.',
    langBtn: 'EN',
    strikes: '타격', par: '기준', layersLeft: '남은 겹',
    undo: '되돌리기', restart: '처음부터', hint: '힌트',
    resultMoves: '{s}수 · 기준 {p}', moves: '수', tapeTip: '테이프를 빈칸으로 끌어다 놓으세요 (누르고 칸을 눌러도 됩니다 · T)', tapeCount: '마스킹 테이프', retouchCount: '리터칭 물감 (색 글자, 예: AB)', splitCount: '나누기 횟수', hintTape: '표시한 빈칸에 테이프를 끌어다 놓아 보세요.', hintTapePad: '표시한 빈칸에 테이프를 붙여 보세요 (X, 그다음 A).',
    toolTip: '도구를 빈칸으로 끌어다 놓거나, 누른 뒤 칸을 누르세요. 칼: 혼색 → 옆 빈칸 → 보낼 색',
    hintRetouch: '표시한 빈칸에 리터칭 물감을 찍어 보세요.', hintSplit: '표시한 혼색을 나눠, 한쪽을 표시한 빈칸으로 보내 보세요.',
    listProto: '그림들', listMine: '내 레벨', makeOne: '에디터에서 만들 수 있습니다.',
    chapterLabel: '{n}장 · {name}', chapterDone: '{n}장 「{name}」의 그림을 모두 복원했습니다.', nextChapter: '다음 장: {name}',
    extra: 'Extra', locked: '잠김', unlockHint: '{name}을(를) 복원하면 열립니다',
    deadEnd: '물감이 굳었습니다. 모든 그림은 복원할 수 있습니다 — 실수는 더 앞에 있을지도 모릅니다.',
    devLost: '복원 불가 상태 (개발자 표시)',
    hintTooBig: '판이 너무 커서 힌트를 계산할 수 없습니다.',
    hintLost: '지금 상태로는 복원할 수 없습니다. 모든 그림은 복원할 수 있으니 — 더 앞으로 되돌려 보세요.',
    restored: '복원 완료', result: '{s}타 · 기준 {p}', hints: ' · 힌트 {n}회',
    retry: '다시', next: '다음', backEditor: '에디터로',
    devOverlay: '개발자 오버레이', show: '표시', replay: '최적 풀이 재생', hoverRays: '마우스를 올리면 시선 표시',
    brush: '브러시', varnishBrush: '두 겹 칠 (두 번 매치)', underBrush: '아래 겹 색', underSame: '같은 색', mixBrush: '섞을 색 (한 겹만)', mixNone: '없음', origBrush: '원본 물감 (벗기면 안 됨)',
    ruined: '원본이 상했습니다. 되돌리세요.', size: '크기', resize: '크기 변경', clear: '비우기',
    level: '레벨', namePh: '이름', notePh: '플레이어에게 보여줄 문구',
    analyze: '분석', testPlay: '테스트 플레이', save: '내 레벨에 저장', exportJson: '내보내기', importJson: '가져오기',
    editorTitle: '에디터', editorNote: '타일을 칠한 뒤 분석을 누르세요. 왼쪽 레벨을 누르면 여기로 불러옵니다.',
    wTitle: '플레이 테스트에 참여해 주셔서 감사합니다',
    w1: '첫 그림부터 순서대로 플레이해 주세요.',
    w2: '막히면 그만두거나 다음 그림으로 넘어가도 괜찮습니다. 그것도 소중한 기록입니다.',
    w3: '힌트는 되도록 쓰지 말아 주세요.',
    w4: '다 하셨으면 이 탭을 닫기만 하면 됩니다. 따로 보내실 것은 없습니다.',
    wData: '입력하신 이름과 플레이 기록(어디를 언제 두드렸는지, 되돌리기)이 개발자에게 자동으로 전송됩니다. 그 밖의 개인정보는 수집하지 않습니다.',
    wNameLabel: '이름 또는 별명',
    wNamePh: '예: 민수',
    wStart: '시작하기',
  },
  en: {
    brandSub: 'prototype', play: 'Play', editor: 'Editor', rec: '● REC',
    keys: 'Z undo · R restart · H hint · M sound · D dev',
    soundOn: 'Sound on', soundOff: 'Sound off',
    keysPlay: 'Z undo · R restart · H hint · M sound',
    keysPad: 'D-pad move · A strike · B undo · X tool (hold + D-pad to choose) · Y hint · View restart · Menu sound · LB/RB painting',
    padTapForSound: 'Gamepad connected. Tap the screen once to hear the sound.',
    resultMoves: '{s} moves · par {p}', moves: 'Moves', tapeTip: 'Drag tape onto an empty cell (or click it, then a cell · T)', tapeCount: 'Masking tape', retouchCount: 'Retouch dabs (pigment letters, e.g. AB)', splitCount: 'Splits', hintTape: 'Try dragging tape onto the marked cell.', hintTapePad: 'Try taping the marked cell (X, then A).',
    toolTip: 'Drag a tool onto an empty cell, or click it and then a cell. Knife: mixed dab, then an empty neighbour, then the pigment to send',
    hintRetouch: 'Try a retouch dab on the marked cell.', hintSplit: 'Try splitting the marked mixed dab, sending one pigment to the marked cell.',
    langBtn: '한국어',
    strikes: 'Strikes', par: 'par', layersLeft: 'Layers left',
    undo: 'Undo', restart: 'Restart', hint: 'Hint',
    listProto: 'Paintings', listMine: 'My levels', makeOne: 'Make one in the Editor.',
    chapterLabel: 'Chapter {n} · {name}', chapterDone: 'Chapter {n}, {name}: every painting restored.', nextChapter: 'Next chapter: {name}',
    extra: 'Extra', locked: 'locked', unlockHint: 'Restore {name} to open this',
    deadEnd: 'The paint has set. Every painting can be restored — the mistake may lie further back.',
    devLost: 'Lost position (dev).',
    hintTooBig: 'Position too large to hint.',
    hintLost: 'This can no longer be restored as it is. Every painting can be — undo further back.',
    restored: 'RESTORED', result: '{s} strikes · par {p}', hints: ' · {n} hint(s)',
    retry: 'Retry', next: 'Next', backEditor: 'Back to editor',
    devOverlay: 'Dev overlay', show: 'show', replay: 'Replay optimal solution', hoverRays: 'Hover shows lines of sight',
    brush: 'Brush', varnishBrush: 'Double coat (2 matches)', underBrush: 'Coat beneath', underSame: 'same pigment', mixBrush: 'Mixed with (single coat)', mixNone: 'nothing', origBrush: 'Original paint (must not be lifted)',
    ruined: 'The original is damaged. Undo.', size: 'Size', resize: 'Resize', clear: 'Clear',
    level: 'Level', namePh: 'Name', notePh: 'Note shown to the player',
    analyze: 'Analyze', testPlay: 'Test play', save: 'Save to My levels', exportJson: 'Export', importJson: 'Import',
    editorTitle: 'Editor', editorNote: 'Paint tiles, then Analyze. Click a level on the left to load it here.',
    wTitle: 'Thank you for playtesting',
    w1: 'Play the paintings in order, starting with the first.',
    w2: 'If you get stuck, it is fine to stop or skip ahead. That is useful too.',
    w3: 'Please avoid hints.',
    w4: 'When you are done, just close this tab. Nothing to send.',
    wData: 'The name you enter and your play (where and when you struck, undos) are sent to the developer automatically. No other personal details are collected.',
    wNameLabel: 'Name or nickname',
    wNamePh: 'e.g. Alex',
    wStart: 'Start',
  },
};

export const lang = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && STR[q]) { localStorage.setItem(KEY, q); return q; }
    const s = localStorage.getItem(KEY);
    return STR[s] ? s : 'ko';
  } catch { return 'ko'; }
})();
document.documentElement.lang = lang;

/** UI string with {var} substitution. */
export function t(key, vars = {}) {
  const s = STR[lang][key] ?? STR.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** A level's text field in the current language (name, note, voice). */
export function lt(def, field) {
  return (lang !== 'en' && def?.[lang]?.[field]) || def?.[field];
}

export function toggleLang() {
  try { localStorage.setItem(KEY, lang === 'ko' ? 'en' : 'ko'); } catch { }
  location.href = location.pathname; // drop any ?lang= so the stored choice wins
}

/** Fill elements marked data-i18n (text) and data-i18n-ph (placeholder). */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
}
