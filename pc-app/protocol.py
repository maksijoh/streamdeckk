"""Validation and fixed, non-sensitive protocol responses."""
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

MAX_SIZE = 65536
SCHEMA = json.loads((Path(__file__).resolve().parent.parent / "shared/protocol.schema.json").read_text(encoding="utf-8"))


def validator(name):
    return Draft202012Validator({"$ref": f"#/$defs/{name}", "$defs": SCHEMA["$defs"]}, format_checker=FormatChecker())


CLIENT = validator("clientMessage")
CONFIG = validator("config")
REQUEST_ID = validator("requestId")
BUTTON_ID = validator("buttonId")
ERRORS = {item["code"]: item["message"] for item in SCHEMA["$defs"]["error"]["enum"]}


def reject_constant(value):
    raise ValueError("Invalid JSON constant")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def decode(text):
    return json.loads(text, parse_constant=reject_constant, object_pairs_hook=unique_object)


def encode(message):
    text = json.dumps(message, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    if len(text.encode("utf-8")) > MAX_SIZE:
        raise ValueError("Message exceeds protocol size limit")
    return text


def correlatable(message):
    return (isinstance(message, dict) and message.get("type") == "press"
            and REQUEST_ID.is_valid(message.get("requestId"))
            and BUTTON_ID.is_valid(message.get("buttonId")))


def ack(message, code=None):
    return {"type": "ack", "requestId": message["requestId"], "buttonId": message["buttonId"],
            "ok": code is None, "error": None if code is None else {"code": code, "message": ERRORS[code]}}
