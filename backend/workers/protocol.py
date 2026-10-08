"""One JSON object per line; images stay on disk. No engine objects cross IPC."""
import json

VERSION = 1


def _json_value(value):
    # Kraken metadata may contain NumPy scalars/arrays. Keep NumPy out of the API.
    if hasattr(value, "tolist"):
        return value.tolist()
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")


def encode(message: dict) -> str:
    return json.dumps(message, ensure_ascii=False, allow_nan=False, default=_json_value) + "\n"


def decode(line: str) -> dict:
    message = json.loads(line)
    if not isinstance(message, dict) or message.get("version") != VERSION:
        raise ValueError("Unsupported worker protocol version")
    return message
