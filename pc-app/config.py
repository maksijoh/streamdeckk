"""Only local config can define executable actions."""
from pathlib import Path

from protocol import CONFIG, decode, encode


def load_config(path, revision=1):
    source = decode(Path(path).read_text(encoding="utf-8"))
    if not isinstance(source, dict) or set(source) != {"buttons"} or not isinstance(source["buttons"], list):
        raise ValueError("Config must contain a buttons array")
    visible, actions = [], {}
    for button in source["buttons"]:
        if not isinstance(button, dict) or set(button) - {"id", "label", "icon", "action"} or "action" not in button:
            raise ValueError("Invalid local button fields")
        shown = {key: button[key] for key in ("id", "label", "icon") if key in button}
        visible.append(shown)
        action = button["action"]
        if not isinstance(action, dict) or not isinstance(action.get("kind"), str):
            raise ValueError("Action requires a kind")
        if "enabled" in action and type(action["enabled"]) is not bool:
            raise ValueError("Action enabled must be boolean")
        kind = action["kind"]
        fields = {"launch_app": {"path", "args", "cwd"}, "run_script": {"path", "args", "cwd", "timeout"},
                  "hotkey": {"keys"}, "media": {"command"}}
        if kind in fields:
            if set(action) - (fields[kind] | {"kind", "enabled"}):
                raise ValueError("Unknown action fields")
            if kind in ("launch_app", "run_script"):
                if not isinstance(action.get("path"), str) or not action["path"] or "\x00" in action["path"]:
                    raise ValueError("Action requires an executable path")
                if Path(action["path"]).suffix.lower() in (".bat", ".cmd"):
                    raise ValueError("Use an explicitly configured interpreter for batch scripts")
                if not isinstance(action.get("args", []), list) or any(not isinstance(arg, str) or "\x00" in arg for arg in action.get("args", [])):
                    raise ValueError("Action args must be strings")
                if "cwd" in action and (not isinstance(action["cwd"], str) or not action["cwd"]):
                    raise ValueError("Action cwd must be a directory")
                if kind == "run_script" and (type(action.get("timeout", 20)) not in (int, float) or not 0 < action.get("timeout", 20) <= 25):
                    raise ValueError("Script timeout must be greater than 0 and at most 25 seconds")
            if kind == "hotkey":
                from actions import key_codes
                key_codes(action.get("keys"))
            if kind == "media":
                from actions import MEDIA
                if action.get("command") not in MEDIA:
                    raise ValueError("Invalid media command")
        # Unknown kinds remain visible and produce unsupported_action.
        if not isinstance(shown.get("id"), str) or shown["id"] in actions:
            raise ValueError("Missing or duplicate button ID")
        actions[shown["id"]] = action
    message = {"type": "config", "protocolVersion": 1, "revision": revision, "buttons": visible}
    CONFIG.validate(message)
    encode(message)  # Enforce the outgoing byte limit before committing a reload.
    return message, actions
