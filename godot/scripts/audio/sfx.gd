extends Node
## Placeholder sound effects, synthesized when the game starts (no files, nothing to license). They
## are stand-ins until the sound design pass: short, soft, and tuned around D, the music's tonal
## centre, so they sit under the music rather than on top of it.
##
##   lift      a strike lifts paint off the canvas (wet scrape + soft thock)
##   peel      a strike takes a top coat and a coat stays (thinner, higher)
##   lift_mix  a strike lifts a mixed tile (the scrape with a two-note thock)
##   fizzle    a strike that pairs nothing
##   ruin      original paint was lifted (low, detuned)
##   undo      undo (a scrape played backwards)
##   restart   restart (a soft swell)
##   win       painting restored (a D major arpeggio of soft bells)
##   tick      a painting opened from the list
##   tape_on, tape_off, palette   for the tape and palette tools (not in the Godot game yet)
##
## Recorded sounds replace a placeholder when they are there: res://audio/sfx/<name>_<k>.wav (k = 1..3,
## made with tools/sfx.mjs and picked in tools/sfx-pick.html); one of them plays at random each time.

const RATE := 22050
const BUS := "Sfx"
const VOLUME_DB := -10.0  ## a strike peaked at -5 dB at -6, over music peaking at -20 (2026-11-26)
const VOICES := 6
const MAX_RECORDED := 3

var muted := false
var _streams := {}          ## name -> AudioStreamWAV (synthesized)
var _recorded := {}         ## name -> [AudioStream] picked files, used instead of the synthesized one
var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _made_bus := false
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	var bus := AudioServer.get_bus_index(BUS)
	if bus < 0:
		AudioServer.add_bus()
		bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(bus, BUS)
		AudioServer.set_bus_send(bus, "Master")
		_made_bus = true
	AudioServer.set_bus_volume_db(bus, VOLUME_DB)
	for i in VOICES:
		var p := AudioStreamPlayer.new()
		p.bus = BUS
		# mixed by Godot, as the music (see music.gd: a runtime bus is silent in the web's sample mode)
		p.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
		add_child(p)
		_players.append(p)
	_build_all()
	for sound in _streams:
		var files: Array[AudioStream] = []
		for k in range(1, MAX_RECORDED + 1):
			var path := "res://audio/sfx/%s_%d.wav" % [sound, k]
			if ResourceLoader.exists(path):
				files.append(load(path))
		if not files.is_empty():
			_recorded[sound] = files


func _exit_tree() -> void:
	for p in _players:
		p.stop()
		p.stream = null
	if _made_bus:
		AudioServer.remove_bus(AudioServer.get_bus_index(BUS))
		_made_bus = false


func set_muted(on: bool) -> void:
	muted = on
	AudioServer.set_bus_mute(AudioServer.get_bus_index(BUS), on)


func has(sound: String) -> bool:
	return _streams.has(sound)


## "recorded" when picked files are used for this sound, else "synth".
func source(sound: String) -> String:
	return "recorded" if _recorded.has(sound) else "synth"


## Play a sound; `pitch` > 1 is higher. A little random pitch keeps repeats from sounding mechanical.
func play(sound: String, pitch := 1.0) -> void:
	if not _streams.has(sound) or DisplayServer.get_name() == "headless":
		return
	var p := _players[_next]
	_next = (_next + 1) % _players.size()
	if _recorded.has(sound):
		var files: Array = _recorded[sound]
		p.stream = files[_rng.randi() % files.size()]
	else:
		p.stream = _streams[sound]
	p.pitch_scale = pitch * _rng.randf_range(0.97, 1.03)
	p.play()


# ---------- synthesis ----------

const D2 := 73.42
const D3 := 146.83
const A3 := 220.0
const D5 := 587.33
const FS5 := 739.99
const A5 := 880.0
const D6 := 1174.66


func _build_all() -> void:
	_streams.lift = _wav(_sum([_scrape(0.30, 3200.0, 500.0, 1.0), _thock(0.12, D3 * 0.75, 0.6)]))
	_streams.peel = _wav(_sum([_scrape(0.20, 5200.0, 1600.0, 0.7), _thock(0.08, A3, 0.35)]))
	_streams.lift_mix = _wav(_sum([_scrape(0.30, 3200.0, 500.0, 1.0), _thock(0.12, D3 * 0.75, 0.4), _thock(0.12, A3 * 0.75, 0.35)]))
	_streams.fizzle = _wav(_sum([_thock(0.10, D3, 0.5), _scrape(0.04, 1500.0, 900.0, 0.25)]))
	_streams.ruin = _wav(_sum([_tone(0.7, D2, 0.5, 0.25), _tone(0.7, D2 * 1.06, 0.4, 0.25), _scrape(0.10, 1800.0, 300.0, 0.6)]))
	_streams.undo = _wav(_reverse(_scrape(0.18, 3000.0, 700.0, 0.7)))
	_streams.restart = _wav(_swell(0.45, 400.0, 2400.0, 0.6))
	var bells := PackedFloat32Array()
	var notes := [D5, FS5, A5, D6]
	for i in notes.size():
		bells = _mix_at(bells, _bell(1.4, notes[i], 0.32), int(i * 0.12 * RATE))
	_streams.win = _wav(bells)
	_streams.tick = _wav(_thock(0.03, 1200.0, 0.3))
	_streams.tape_on = _wav(_crackle(0.14, 0.5, 4000.0))
	_streams.tape_off = _wav(_crackle(0.30, 0.7, 6000.0))
	_streams.palette = _wav(_sum([_thock(0.09, 300.0, 0.45), _scrape(0.08, 2200.0, 800.0, 0.4)]))


## Low-passed noise whose cutoff falls from `f0` to `f1`: paint scraped off.
func _scrape(seconds: float, f0: float, f1: float, amp: float) -> PackedFloat32Array:
	var n := int(seconds * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var y := 0.0
	for i in n:
		var t := float(i) / n
		var fc := lerpf(f0, f1, t)
		var a := 1.0 - exp(-TAU * fc / RATE)
		y += a * (_rng.randf_range(-1.0, 1.0) - y)
		out[i] = y * amp * _env(i, n, 0.006)
	return out


## A short sine that drops in pitch: a soft knock.
func _thock(seconds: float, freq: float, amp: float) -> PackedFloat32Array:
	var n := int(seconds * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var phase := 0.0
	for i in n:
		var t := float(i) / n
		phase += TAU * freq * lerpf(1.0, 0.7, t) / RATE
		out[i] = sin(phase) * amp * _env(i, n, 0.002)
	return out


func _tone(seconds: float, freq: float, amp: float, attack: float) -> PackedFloat32Array:
	var n := int(seconds * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	for i in n:
		out[i] = sin(TAU * freq * i / RATE) * amp * _env(i, n, attack * seconds)
	return out


## Sine with a quieter inharmonic partial and a long decay.
func _bell(seconds: float, freq: float, amp: float) -> PackedFloat32Array:
	var n := int(seconds * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	for i in n:
		var t := float(i) / RATE
		var s := sin(TAU * freq * t) + 0.25 * sin(TAU * freq * 2.76 * t) * exp(-t * 6.0)
		out[i] = s * amp * exp(-t * 3.2) * minf(1.0, t / 0.004)
	return out


## Noise that rises and opens, then stops: a breath in.
func _swell(seconds: float, f0: float, f1: float, amp: float) -> PackedFloat32Array:
	var n := int(seconds * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var y := 0.0
	for i in n:
		var t := float(i) / n
		var a := 1.0 - exp(-TAU * lerpf(f0, f1, t) / RATE)
		y += a * (_rng.randf_range(-1.0, 1.0) - y)
		out[i] = y * amp * sin(PI * t) * sin(PI * t)
	return out


## Sticky crackle: noise gated by random short bursts.
func _crackle(seconds: float, amp: float, fc: float) -> PackedFloat32Array:
	var n := int(seconds * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var y := 0.0
	var a := 1.0 - exp(-TAU * fc / RATE)
	var gate := 0.0
	for i in n:
		if _rng.randf() < 0.004:
			gate = 1.0
		gate *= 0.993
		y += a * (_rng.randf_range(-1.0, 1.0) - y)
		out[i] = y * amp * (0.25 + gate) * _env(i, n, 0.004)
	return out


## Attack over `attack` seconds, then an exponential fall to silence at the end.
func _env(i: int, n: int, attack: float) -> float:
	var t := float(i) / RATE
	var rise := minf(1.0, t / maxf(attack, 0.0005))
	var fall := exp(-4.0 * float(i) / n) * (1.0 - float(i) / n)
	return rise * fall


func _reverse(a: PackedFloat32Array) -> PackedFloat32Array:
	var out := a.duplicate()
	out.reverse()
	return out


func _mix_at(base: PackedFloat32Array, add: PackedFloat32Array, offset: int) -> PackedFloat32Array:
	if base.size() < offset + add.size():
		base.resize(offset + add.size()) # (new samples are 0)
	for i in add.size():
		base[offset + i] += add[i]
	return base


## Parts played together (for packed arrays `+` would play them one after another).
func _sum(parts: Array) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for part in parts:
		out = _mix_at(out, part, 0)
	return out


## 16-bit mono WAV.
func _wav(samples: PackedFloat32Array) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in samples.size():
		data.encode_s16(i * 2, int(clampf(samples[i], -1.0, 1.0) * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = data
	return w
