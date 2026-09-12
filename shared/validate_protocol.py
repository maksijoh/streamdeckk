"""Run: python -m pip install -r shared/requirements-test.txt; python shared/validate_protocol.py."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


def check():
    root = Path(__file__).resolve().parent
    schema = json.loads((root / "protocol.schema.json").read_text(encoding="utf-8"))
    fixtures = json.loads((root / "fixtures.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)

    def validator(name=None):
        selected = schema if name is None else {
            "$defs": schema["$defs"], "$ref": f"#/$defs/{name}"
        }
        return Draft202012Validator(selected, format_checker=FormatChecker())

    def errors_with_context(errors):
        for error in errors:
            yield error
            yield from errors_with_context(error.context)

    def unique_ids(message):
        if message["type"] == "config":
            ids = [button["id"] for button in message["buttons"]]
            assert len(ids) == len(set(ids)), "duplicate button IDs"

    for message in fixtures["valid"]:
        validator().validate(message)
        unique_ids(message)
        client = message["type"] in {"press", "ping"}
        assert validator("clientMessage").is_valid(message) == client
        assert validator("serverMessage").is_valid(message) != client
        assert len(json.dumps(message, ensure_ascii=False).encode("utf-8")) <= 65536
    assert {m["type"] for m in fixtures["valid"]} == {"press", "ack", "config", "ping", "pong"}

    for fixture in fixtures["invalid"]:
        assert not validator().is_valid(fixture["message"]), fixture["name"]
        errors = errors_with_context(validator(fixture.get("schema")).iter_errors(fixture["message"]))
        assert any(e.validator == fixture["keyword"] and list(e.absolute_path) == fixture["path"]
                   for e in errors), fixture["name"]

    for fixture in fixtures["invalidSemantic"]:
        validator().validate(fixture["message"])
        try:
            unique_ids(fixture["message"])
        except AssertionError:
            pass
        else:
            raise AssertionError(fixture["name"])

    def reject_constant(value):
        raise ValueError(value)

    for raw in fixtures["invalidJson"]:
        try:
            json.loads(raw, parse_constant=reject_constant)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Accepted invalid JSON: {raw}")

    print(f"PASS: schema; {len(fixtures['valid'])} valid messages; "
          f"{len(fixtures['invalid'])} invalid schema fixtures; "
          f"{len(fixtures['invalidSemantic'])} semantic fixture; "
          f"{len(fixtures['invalidJson'])} malformed JSON fixtures; direction checks")


if __name__ == "__main__":
    check()
