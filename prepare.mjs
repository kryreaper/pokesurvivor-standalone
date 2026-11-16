import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const upstreamRevision = '1eb34592308f7c1731b3939a37738619b797609e';
const source = fileURLToPath(new URL('.', import.meta.url));

function edit(project, path, before, after) {
  const file = join(project, path);
  const code = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  if (code.includes(after)) return;
  if (!code.includes(before) || code.indexOf(before) !== code.lastIndexOf(before)) {
    throw new Error(`Expected one patch location in ${path}: ${before}`);
  }
  writeFileSync(file, code.replace(before, () => after));
}

export function prepare(project, template) {
  copyFileSync(join(source, 'offline_bridge.gd'), join(project, 'scripts/offline_bridge.gd'));
  const preset = readFileSync(join(source, 'web-preset.cfg'), 'utf8');
  writeFileSync(join(project, 'export_presets.cfg'), preset.replace(
    'custom_template/release=""', `custom_template/release="${template.replaceAll('\\', '/')}"`,
  ));
  edit(project, 'project.godot', '[autoload]\n',
    '[autoload]\n\nOfflineBridge="*res://scripts/offline_bridge.gd"\n');
  edit(project, 'project.godot', 'renderer/rendering_method="mobile"',
    'renderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.web="gl_compatibility"');
  edit(project, 'project.godot', 'textures/vram_compression/import_etc2_astc=true',
    'textures/vram_compression/import_etc2_astc=false');
  edit(project, 'scripts/menu.gd', '\t\tvar upd := UPD.new()',
    '\tif not OS.has_feature("offline_html") and not is_overlay:\n\t\tvar upd := UPD.new()');
  edit(project, 'scripts/menu.gd', '+ " · Android", 18)', '+ " · Offline Web", 18)');
  edit(project, 'scripts/menu.gd', 'credit_lbl.text = L.t("Hecho por JayElDragon")',
    'credit_lbl.text = L.t("Hecho por JayElDragon") + "\\nWeb · KryReaper"');
  edit(project, 'scripts/menu.gd', 'func(): if cur != "support": _show("support")',
    'func(): JavaScriptBridge.get_interface("PokeSurvivorOffline").showCredits()');
  edit(project, 'scripts/menu.gd', 'support_top.tooltip_text = L.t("Apoyar")',
    'support_top.tooltip_text = "Credits and licenses"');
  edit(project, 'scripts/menu.gd', '\t_build_support()\n', '\t# The offline credits dialog replaces the donation screen.\n');
  edit(project, 'scripts/menu.gd', '\touter.add_child(ok)\n\t_gf(ok)',
    `\tvar footer := HBoxContainer.new()
\tfooter.alignment = BoxContainer.ALIGNMENT_CENTER
\touter.add_child(footer)
\tvar retry := _btn("Play again", func():
\t\tPG.off = false
\t\tEngine.time_scale = 1.0
\t\tget_tree().change_scene_to_file("res://scenes/main.tscn"), Vector2(200, 56))
\tfooter.add_child(retry)
\tfooter.add_child(ok)
\t_gf(ok)`);
  edit(project, 'scripts/menu.gd', 'func(): OS.shell_open(REPO_URL)',
    'func(): JavaScriptBridge.get_interface("PokeSurvivorOffline").showCredits()');

  edit(project, 'scripts/save_data.gd', '\tvar parsed = _read_json(PATH)', `\tvar parsed = _read_json(PATH)
\tif OS.has_feature("offline_html"):
\t\tvar standalone := JavaScriptBridge.get_interface("PokeSurvivorOffline")
\t\tif standalone != null:
\t\t\tvar browser_save = JSON.parse_string(str(standalone.readSave()))
\t\t\tif browser_save is Dictionary:
\t\t\t\tparsed = browser_save`);
  edit(project, 'scripts/save_data.gd', '\tvar f := FileAccess.open(TMP, FileAccess.WRITE)',
    `\tif OS.has_feature("offline_html"):
\t\tvar standalone := JavaScriptBridge.get_interface("PokeSurvivorOffline")
\t\tif standalone != null:
\t\t\tstandalone.writeSave(JSON.stringify(d))
\t\treturn
\tvar f := FileAccess.open(TMP, FileAccess.WRITE)`);
  edit(project, 'scripts/main.gd', 'func _notification(what: int) -> void:\n',
    `func _notification(what: int) -> void:
\tif what == NOTIFICATION_APPLICATION_FOCUS_OUT and OS.has_feature("offline_html"):
\t\tif player != null and not player.dead and not choosing and not shop_open:
\t\t\tpaused = true
\t\treturn
`);
  edit(project, 'scripts/textscale.gd', `\troot.get_tree().node_added.connect(func(n: Node):
\t\tif k() > 1.0 and root.is_ancestor_of(n):
\t\t\tscale_node.call_deferred(n))`, `\tvar tree := root.get_tree()
\tvar on_added := func(n: Node):
\t\tif k() > 1.0 and root.is_ancestor_of(n):
\t\t\tscale_node.call_deferred(n)
\ttree.node_added.connect(on_added)
\troot.tree_exiting.connect(func(): tree.node_added.disconnect(on_added), CONNECT_ONE_SHOT)`);
}
