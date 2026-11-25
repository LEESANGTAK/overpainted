extends Node
## Playtest log (port of the prototype's log / flushLog, prototype/app.js): events in the prototype's
## format, so tools/pull-playtests.mjs and tools/playtest.mjs read them unchanged; each session also
## says engine "godot". Sent every FLUSH_EVERY seconds to the Google Sheet collector
## (docs/playtest-setup.md), as {session, events} JSON in a "simple" text/plain POST.
##
## Only builds exported with the "playtest" feature record (see export_presets.cfg); editor runs and a
## release build without it record nothing. A test can point `url_override` at the local dev server
## (tools/serve.mjs: http://localhost:5173/api/playlog writes playtests/<session>.jsonl).
##
## Leaving: on the web, what is not yet sent goes out with navigator.sendBeacon when the tab is hidden
## or closed; on the desktop, closing the window waits (up to QUIT_WAIT) for the last batch.

## The collector web app (same as prototype/config.js COLLECTOR_URL; it can only append).
const COLLECTOR_URL := "https://script.google.com/macros/s/AKfycbwIzQA6kCdrf2WBvJsTG4ScifutA5fK3UrMpGvVFPOTfLwVx0FOPDL45GjI7gfcuaya/exec"
const FLUSH_EVERY := 2.0
const QUIT_WAIT := 3.0
const MAX_KEEP := 5000     ## events kept for a retry while offline

static var url_override := ""

var enabled := false
var session := ""
var level_id = null        ## the painting the events belong to ("lvl"), or null
var sent_ok := true        ## the last batch went through (the REC mark dims when not)

var _buffer: Array = []
var _http: HTTPRequest
var _in_flight: Array = []
var _timer := 0.0
var _quitting := false


func _ready() -> void:
	var now := Time.get_datetime_dict_from_system()
	session = "%04d%02d%02d-%02d%02d%02d-%s" % [now.year, now.month, now.day, now.hour, now.minute, now.second, _random_id(4)]
	_http = HTTPRequest.new()
	_http.timeout = 10.0
	add_child(_http)
	_http.request_completed.connect(_on_sent)


## Start recording (call once): in a playtest build (on), or whenever a test set url_override.
func start(on: bool) -> void:
	enabled = url_override != "" or (on and not OS.has_feature("editor"))
	if not enabled:
		return
	if OS.has_feature("web"):
		_web_listen()
	else:
		get_tree().auto_accept_quit = false


## Where the events go: a test's override; on the web on localhost the dev server (tools/serve.mjs,
## like the prototype, so local plays never reach the sheet); else the collector.
func url() -> String:
	if url_override != "":
		return url_override
	if OS.has_feature("web"):
		var host = JavaScriptBridge.eval("location.hostname", true)
		if host in ["localhost", "127.0.0.1", "[::1]"]:
			return String(JavaScriptBridge.eval("location.origin", true)) + "/api/playlog"
	return COLLECTOR_URL


func add(type: String, data: Dictionary = {}) -> void:
	if not enabled:
		return
	var e := {"t": int(Time.get_unix_time_from_system() * 1000.0), "type": type, "lvl": level_id}
	e.merge(data)
	_buffer.append(e)
	if OS.has_feature("web"):
		_web_mirror()


func _process(delta: float) -> void:
	if not enabled:
		return
	_timer += delta
	if _timer >= FLUSH_EVERY:
		_timer = 0.0
		flush()


## Send what is buffered (one batch at a time).
func flush() -> void:
	if _buffer.is_empty() or not _in_flight.is_empty():
		return
	_in_flight = _buffer.duplicate()
	_buffer.clear()
	var body := JSON.stringify({"session": session, "events": _in_flight})
	var err := _http.request(url(), ["Content-Type: text/plain;charset=utf-8"], HTTPClient.METHOD_POST, body)
	if err != OK:
		_on_sent(HTTPRequest.RESULT_CANT_CONNECT, 0, [], PackedByteArray())


func _on_sent(result: int, code: int, _headers, _body) -> void:
	# The collector answers with a redirect to another origin; on the web the reply may not be readable
	# (CORS) though the events arrived, so a finished request counts as sent there.
	var ok := result == HTTPRequest.RESULT_SUCCESS and code < 400
	if OS.has_feature("web") and result not in [HTTPRequest.RESULT_CANT_CONNECT, HTTPRequest.RESULT_CANT_RESOLVE, HTTPRequest.RESULT_TIMEOUT]:
		ok = true
	if not ok and _in_flight.size() + _buffer.size() < MAX_KEEP:
		_buffer = _in_flight + _buffer # keep them for the next try
	_in_flight = []
	sent_ok = ok
	if OS.has_feature("web"):
		_web_mirror()
	if _quitting and (_buffer.is_empty() or not ok):
		get_tree().quit()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST and enabled and not OS.has_feature("web"):
		_quitting = true
		add("session_end")
		flush()
		get_tree().create_timer(QUIT_WAIT).timeout.connect(get_tree().quit)


static func _random_id(n: int) -> String:
	const CHARS := "abcdefghijklmnopqrstuvwxyz0123456789"
	var s := ""
	for i in n:
		s += CHARS[randi() % CHARS.length()]
	return s


## A fresh anonymous id for this browser / install.
static func new_browser_id() -> String:
	return _random_id(8)


# ---------- web: the tab can close at any moment ----------

var _js_hidden: JavaScriptObject   ## kept alive: JavaScriptBridge callbacks must be referenced


func _web_listen() -> void:
	JavaScriptBridge.eval("""
		window.__opLog = { url: %s, session: %s, events: [] };
		addEventListener('pagehide', () => {
			const l = window.__opLog;
			l.events.push({ t: Date.now(), type: 'session_end', lvl: null });
			const body = JSON.stringify({ session: l.session, events: l.events });
			navigator.sendBeacon(l.url, new Blob([body], { type: 'text/plain;charset=utf-8' }));
			l.events = [];
		});
	""" % [JSON.stringify(url()), JSON.stringify(session)], true)
	_js_hidden = JavaScriptBridge.create_callback(_on_visibility)
	var document := JavaScriptBridge.get_interface("document")
	document.addEventListener("visibilitychange", _js_hidden)


func _on_visibility(_args) -> void:
	var hidden: bool = JavaScriptBridge.eval("document.hidden", true)
	add("away" if hidden else "back")
	if hidden:
		flush() # a tab that is closed or frozen right after this still delivers (the beacon has the rest)


## Keep a copy of the unsent events on the page, for the beacon at pagehide.
func _web_mirror() -> void:
	JavaScriptBridge.eval("window.__opLog && (window.__opLog.events = %s);" % JSON.stringify(_in_flight + _buffer), true)
