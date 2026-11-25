extends RefCounted
## Screen text in Korean and English (the prototype's prototype/i18n.js wording): Strings.t("key", {n = 1}).
## Kept as a plain table rather than Godot translation files: two languages, a few dozen lines, and
## level names and notes come from the levels file anyway.

static var lang := "ko"


## The language to start in when the player has not chosen one: Korean on a Korean system, else English.
static func system_lang() -> String:
	return "ko" if OS.get_locale_language() == "ko" else "en"

const STR := {
	"ko": {
		"strikes": "타격", "par": "기준", "layers_left": "남은 겹",
		"undo": "되돌리기", "restart": "처음부터", "prev": "이전", "next": "다음", "retry": "다시",
		"chapter_label": "{n}장 · {name}",
		"restored": "복원 완료",
		"result": "{s}타 · 기준 {p}",
		"next_chapter": "다음 장: {name}",
		"dead_end": "물감이 굳었습니다. 모든 그림은 복원할 수 있습니다 — 실수는 더 앞에 있을지도 모릅니다.",
		"ruined": "원본이 상했습니다. 되돌리세요.",
		"keys": "방향키 커서 · Space 두드리기 · Z 되돌리기 · R 처음부터 · H 힌트 · M 소리 · PgUp/PgDn 그림 · Esc 목록",
		"keys_pad": "십자키 이동 · A 두드리기 · B 되돌리기 · View 처음부터 · Y 힌트 · LB/RB 그림 · Menu 목록",
		"hints": " · 힌트 {n}회",
		"hint_lost": "지금 상태로는 복원할 수 없습니다. 모든 그림은 복원할 수 있으니 — 더 앞으로 되돌려 보세요.",
		"hint_too_big": "판이 너무 커서 힌트를 계산할 수 없습니다.",
		"title_sub": "덧칠 아래의 그림을 되찾는 복원가의 퍼즐",
		"paintings": "그림들", "back_to_list": "그림 목록", "extra": "Extra", "locked": "잠김",
		"unlock_hint": "{name}을(를) 복원하면 열립니다",
		"chapter_done": "{n}장 「{name}」의 그림을 모두 복원했습니다.",
		"lang_button": "English", "sight": "시선 미리 보기", "sound": "소리",
		"select_keys": "방향키·십자키로 고르고 Enter·A로 엽니다",
		"rec": "● 녹화",
		"w_title": "플레이 테스트에 참여해 주셔서 감사합니다",
		"w1": "첫 그림부터 순서대로 플레이해 주세요.",
		"w2": "막히면 그만두거나 다음 그림으로 넘어가도 괜찮습니다. 그것도 소중한 기록입니다.",
		"w3": "힌트는 되도록 쓰지 말아 주세요.",
		"w4": "다 하셨으면 게임을 닫기만 하면 됩니다. 따로 보내실 것은 없습니다.",
		"w_name_label": "이름 또는 별명",
		"w_name_ph": "예: 민수",
		"w_data": "입력하신 이름과 플레이 기록(어디를 언제 두드렸는지, 되돌리기)이 개발자에게 자동으로 전송됩니다. 그 밖의 개인정보는 수집하지 않습니다.",
		"w_start": "시작하기",
	},
	"en": {
		"strikes": "Strikes", "par": "Par", "layers_left": "Layers left",
		"undo": "Undo", "restart": "Restart", "prev": "Previous", "next": "Next", "retry": "Retry",
		"chapter_label": "Chapter {n} · {name}",
		"restored": "RESTORED",
		"result": "{s} strikes · par {p}",
		"next_chapter": "Next chapter: {name}",
		"dead_end": "The paint has set. Every painting can be restored — the mistake may lie further back.",
		"ruined": "The original is damaged. Undo.",
		"keys": "Arrows cursor · Space strike · Z undo · R restart · H hint · M sound · PgUp/PgDn paintings · Esc list",
		"keys_pad": "D-pad move · A strike · B undo · View restart · Y hint · LB/RB painting · Menu list",
		"hints": " · {n} hint(s)",
		"hint_lost": "This can no longer be restored as it is. Every painting can be — undo further back.",
		"hint_too_big": "Position too large to hint.",
		"title_sub": "A restorer's puzzle: find the painting under the overpaint",
		"paintings": "Paintings", "back_to_list": "Paintings", "extra": "Extra", "locked": "locked",
		"unlock_hint": "Restore {name} to open this",
		"chapter_done": "Chapter {n}, {name}: every painting restored.",
		"lang_button": "한국어", "sight": "Show lines of sight", "sound": "Sound",
		"select_keys": "Arrows or D-pad to choose, Enter or A to open",
		"rec": "● REC",
		"w_title": "Thank you for playtesting",
		"w1": "Play the paintings in order, starting with the first.",
		"w2": "If you get stuck, it is fine to stop or skip ahead. That is useful too.",
		"w3": "Please avoid hints.",
		"w4": "When you are done, just close the game. Nothing to send.",
		"w_name_label": "Name or nickname",
		"w_name_ph": "e.g. Alex",
		"w_data": "The name you enter and your play (where and when you struck, undos) are sent to the developer automatically. No other personal details are collected.",
		"w_start": "Start",
	},
}


static func t(key: String, args: Dictionary = {}) -> String:
	var s: String = STR[lang].get(key, STR["en"].get(key, key))
	for k in args:
		s = s.replace("{%s}" % k, str(args[k]))
	return s


## A level's or chapter's own text field ("name", "note") in the current language.
static func field(def: Dictionary, key: String) -> String:
	if lang != "en" and def.has(lang) and def[lang].has(key):
		return String(def[lang][key])
	return String(def.get(key, ""))
