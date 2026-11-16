extends Node

const SAVE = preload("res://scripts/save_data.gd")
const MENU = "res://scenes/menu.tscn"
const RUN = "res://scenes/main.tscn"

var shell: JavaScriptObject
var importer: JavaScriptObject
var pause_request: JavaScriptObject
var title_ready := false
var sample_in := 0.0


func _ready() -> void:
	shell = JavaScriptBridge.get_interface("PokeSurvivorOffline")
	if shell == null:
		return
	importer = JavaScriptBridge.create_callback(_import_save)
	pause_request = JavaScriptBridge.create_callback(_pause_run)
	shell.registerImporter(importer)
	shell.registerPause(pause_request)
	get_tree().scene_changed.connect(_scene_changed)
	get_tree().process_frame.connect(_scene_changed, CONNECT_ONE_SHOT)


func _scene_changed() -> void:
	var current := get_tree().current_scene
	if current == null:
		return
	if current.scene_file_path == MENU:
		shell.setRunActive(false)
		if not title_ready:
			title_ready = true
			shell.ready()
	elif current.scene_file_path == RUN:
		shell.setRunActive(true)


func _import_save(args: Array) -> void:
	if args.size() != 1 or not args[0] is String:
		return
	var parsed = JSON.parse_string(args[0])
	if not parsed is Dictionary or int(parsed.get("v", 0)) != 1:
		shell.importResult(false)
		return
	_apply_save.call_deferred(parsed)


func _apply_save(parsed: Dictionary) -> void:
	Engine.time_scale = 1.0
	get_tree().paused = false
	SAVE.ensure()
	SAVE.d = SAVE._merge(SAVE.default_data(), parsed)
	SAVE._migrate_upgrades()
	SAVE.last_run = {}
	SAVE.reopen = ""
	SAVE.save()
	var error := get_tree().change_scene_to_file(MENU)
	shell.importResult(error == OK)


func _pause_run(_args: Array) -> void:
	var run = get_tree().current_scene
	if run != null and run.scene_file_path == RUN and run.player != null:
		if not run.player.dead and not run.choosing and not run.shop_open:
			run.paused = true


func _process(delta: float) -> void:
	if shell == null:
		return
	sample_in -= delta
	if sample_in > 0.0:
		return
	sample_in = 0.2
	if not shell.diagnosticsEnabled:
		return
	var run = get_tree().current_scene
	if run == null or run.scene_file_path != RUN or run.player == null:
		return
	var player = run.player
	var nearest_orb: Variant = null
	var distance := INF
	for orb in run.orbs:
		if orb.kind != "xp" and orb.kind != "xpBig":
			continue
		var candidate: float = orb.position.distance_squared_to(player.position)
		if candidate < distance:
			distance = candidate
			nearest_orb = [orb.position.x, orb.position.y]
	var moves: Array = []
	for move in player.moves:
		moves.append([move.get("id", ""), move.get("lvl", 1)])
	var threat = run._nearest_enemy(player.position, 1600.0)
	var nearest_enemy: Variant = [threat.position.x, threat.position.y] if threat != null else null
	shell.publishDiagnostics(JSON.stringify({
		"time": run.run_time, "hp": player.hp, "maxHp": player.max_hp, "level": player.level,
		"xp": player.xp, "kills": run.kills, "position": [player.position.x, player.position.y],
		"paused": run.paused, "choices": run.cards.items.size() if run.cards.open else 0,
		"enemies": run.enemies.size(), "bullets": run.bullets.size(), "orbs": run.orbs.size(),
		"nearestOrb": nearest_orb, "nearestEnemy": nearest_enemy, "moves": moves, "upgrades": run.stat_lv,
		"boss": run._boss_alive(), "dead": player.dead, "fps": Engine.get_frames_per_second(),
	}))
