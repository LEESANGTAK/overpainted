extends SceneTree
## Screenshots of levels for a look at how tiles are drawn.
##   godot --path godot --script res://tests/shots.gd -- out=<folder> <level id> ...

const SaveData := preload("res://scripts/game/save_data.gd")

func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var out := ""
	var ids := []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
		else:
			ids.append(a)
	SaveData.path_override = "user://test_save.json"
	DirAccess.remove_absolute(ProjectSettings.globalize_path(SaveData.path_override))
	var game: Control = load("res://scenes/main.tscn").instantiate()
	root.add_child(game)
	var play: Control = game.play
	await process_frame
	for id in ids:
		for i in play.data.levels.size():
			if play.data.levels[i].id == id:
				play.load_level(i)
				await process_frame
				await process_frame
				root.get_texture().get_image().save_png(out.path_join(id + ".png"))
	quit()
