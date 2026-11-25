extends RefCounted
## Screen text in Korean and English (the prototype's prototype/i18n.js wording).
## Stage 4 of the port moves this to Godot translation files; until then, Strings.t("key", {n = 1}).

static var lang := "ko"

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
		"keys": "방향키 커서 · Space 두드리기 · Z 되돌리기 · R 처음부터 · PgUp/PgDn 그림",
		"keys_pad": "십자키 이동 · A 두드리기 · B 되돌리기 · View 처음부터 · LB/RB 그림",
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
		"keys": "Arrows cursor · Space strike · Z undo · R restart · PgUp/PgDn paintings",
		"keys_pad": "D-pad move · A strike · B undo · View restart · LB/RB painting",
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
