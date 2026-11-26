extends Node
## The room's music (port of prototype/mood.js): two pieces with the same tempo and tonal centre,
## `calm` and `lost` (tools/music.mjs), play together all the time. set_lost() moves the balance between
## them slowly and closes a low-pass filter a little, so the change is felt rather than announced.
## Each piece loops on two players that overlap by SEAM seconds, crossfading where it meets its own start.

const FILES := {"calm": "res://audio/calm.mp3", "lost": "res://audio/lost.mp3"}
const VOLUME := 0.42   ## music under everything
## loudness match: measured RMS calm -25.6 dB, lost -19.5 dB (2026-11-23 files), so lost plays ~6 dB lower
const LEVEL := {"calm": 1.0, "lost": 0.5}
const SEAM := 6.0      ## seconds of crossfade where a loop meets its own start
const TURN := 9.0      ## seconds (time constant x3) for calm -> lost
const RETURN := 6.0    ## and back
const OPEN_HZ := 18000.0
const CLOSED_HZ := 2600.0
const BUS := "Music"

var lost := false
var muted := false

var _gain := {"calm": 0.0, "lost": 0.0}       ## current level of each piece (0..1, linear)
var _target := {"calm": 0.0, "lost": 0.0}
var _cutoff := OPEN_HZ
var _time_constant := 2.0 / 3.0               ## the first fade in: ~2 s
var _players := {}                            ## piece -> [AudioStreamPlayer, AudioStreamPlayer]
var _current := {}                            ## piece -> index of the player whose pass is newest
var _lowpass: AudioEffectLowPassFilter
var _made_bus := false


func _ready() -> void:
	var bus := AudioServer.get_bus_index(BUS)
	if bus < 0:
		AudioServer.add_bus()
		bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(bus, BUS)
		AudioServer.set_bus_send(bus, "Master")
		_lowpass = AudioEffectLowPassFilter.new()
		AudioServer.add_bus_effect(bus, _lowpass)
		_made_bus = true
	else:
		_lowpass = AudioServer.get_bus_effect(bus, 0)
	_lowpass.cutoff_hz = OPEN_HZ
	for k in FILES:
		var stream: AudioStream = load(FILES[k])
		if stream == null:
			push_warning("music not loaded: %s" % FILES[k])
			continue
		var pair := []
		for i in 2:
			var p := AudioStreamPlayer.new()
			p.stream = stream
			p.bus = BUS
			p.volume_db = -80.0
			# Mixed by Godot, as on the desktop. The web build (no threads) would otherwise play it as a
			# Web Audio "sample": there the bus made above got no volume (silent music, found 2026-11-26)
			# and the low-pass filter of a room gone wrong does not run at all.
			p.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
			add_child(p)
			pair.append(p)
		_players[k] = pair
		_current[k] = 0
		# headless runs (tests) have a dummy audio driver that never mixes, so its playbacks would only
		# linger; the balance and the filter still move, which is what the tests check
		if DisplayServer.get_name() != "headless":
			pair[0].play()
	_apply()


func _exit_tree() -> void:
	for k in _players:
		for p: AudioStreamPlayer in _players[k]:
			p.stop()
			p.stream = null # let the audio server drop its playback now, not at exit
	if _made_bus:
		AudioServer.remove_bus(AudioServer.get_bus_index(BUS))
		_made_bus = false


## Turn the room (true) or let it come back (false). Slow on purpose.
func set_lost(on: bool) -> void:
	if on == lost:
		return
	lost = on
	_time_constant = (TURN if on else RETURN) / 3.0
	_apply()


func set_muted(on: bool) -> void:
	muted = on
	AudioServer.set_bus_mute(AudioServer.get_bus_index(BUS), on)


func _apply() -> void:
	_target.calm = (0.12 if lost else 1.0) * VOLUME * LEVEL.calm
	_target.lost = (1.0 if lost else 0.0) * VOLUME * LEVEL.lost


## Current level of a piece (0..1, before the seam fades). For tests.
func level(k: String) -> float:
	return _gain.get(k, 0.0)


func cutoff() -> float:
	return _cutoff


func _process(delta: float) -> void:
	# approach the targets exponentially, like Web Audio's setTargetAtTime
	var a := 1.0 - exp(-delta / _time_constant)
	for k in _gain:
		_gain[k] += (_target[k] - _gain[k]) * a
	_cutoff += ((CLOSED_HZ if lost else OPEN_HZ) - _cutoff) * a
	if _lowpass:
		_lowpass.cutoff_hz = _cutoff
	for k in _players:
		_loop(k)


## Keep piece k going: when the newest pass is SEAM seconds from its end, start the other player from
## the top; each pass fades in over its first SEAM seconds and out over its last.
func _loop(k: String) -> void:
	var pair: Array = _players[k]
	var now: AudioStreamPlayer = pair[_current[k]]
	var length := now.stream.get_length()
	var seam := minf(SEAM, length / 4.0)
	if now.playing and now.get_playback_position() >= length - seam:
		_current[k] = 1 - _current[k]
		var other: AudioStreamPlayer = pair[_current[k]]
		if not other.playing:
			other.play()
	for p: AudioStreamPlayer in pair:
		if not p.playing:
			continue
		var pos: float = p.get_playback_position()
		var fade := clampf(minf(pos / seam, (length - pos) / seam), 0.0, 1.0)
		p.volume_db = linear_to_db(maxf(_gain[k] * fade, 0.00001))
