# The Overpainted — Godot game

The game players get. Levels are designed in the web prototype and the Node tools at the repo root,
then handed over here; see [docs/godot-port.md](../docs/godot-port.md) for the plan.

- Engine: **Godot 4.7.2** (pinned; GDScript, Compatibility renderer so the web export works).
- Base screen 1280×800 (Steam Deck), stretched with `canvas_items` / `expand`.
- `data/levels.json` comes from `node tools/export-godot.mjs` — never edit it by hand. `npm test` fails while it is out of date.
- UI font: Noto Sans KR at weight 400 (`fonts/`).

Open `project.godot` in Godot 4.7.2, or run from the repo root:

```
godot --path godot
```
