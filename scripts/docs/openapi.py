"""Render the declared HTTP contract, including referenced schemas, as Markdown."""
import json
import re


def cell(value: object) -> str:
    """Protect tables from multiline descriptions and union/enum separators."""
    return str(value).replace("|", "&#124;").replace("\n", "<br>")


def anchor(value: str) -> str:
    """Give endpoint and schema links stable explicit Markdown anchors."""
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def schema_type(schema: dict) -> str:
    """Summarize references, nullable unions, arrays, and scalar schemas."""
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        return f"[{cell(name)}](#schema-{anchor(name)})"
    for union in ("anyOf", "oneOf", "allOf"):
        if union in schema:
            joiner = " & " if union == "allOf" else " or "
            return joiner.join(schema_type(item) for item in schema[union])
    kind = schema.get("type", "unspecified")
    if kind == "array":
        return f"array of {schema_type(schema.get('items', {}))}"
    if isinstance(kind, list):
        kind = " or ".join(kind)
    return f"`{cell(kind)}`" + (f" ({cell(schema['format'])})" if schema.get("format") else "")


def schema_notes(schema: dict) -> str:
    """Preserve defaults, enums, constraints, and descriptions without inference."""
    notes = [schema["description"]] if schema.get("description") else []
    for key in ("default", "enum", "const", "minimum", "maximum", "exclusiveMinimum",
                "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern"):
        if key in schema:
            notes.append(f"{key}: `{json.dumps(schema[key], ensure_ascii=False)}`")
    return cell("; ".join(notes))


def render_openapi(schema: dict) -> str:
    """Render actual OpenAPI metadata; runtime exceptions remain separately explained."""
    operations = sorted(
        (path, method, operation)
        for path, methods in schema.get("paths", {}).items()
        for method, operation in methods.items()
        if method.lower() in {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
    )
    lines = [
        "# Backend HTTP API reference", "",
        "Generated from the current FastAPI OpenAPI schema. Edit route metadata, request/response",
        "models, or the generator, then run `yarn docs:generate`; do not edit this page.", "",
        "See [HTTP behavior and errors](../reference/http-behavior.md) for streamed downloads,",
        "job failure semantics, and runtime errors that FastAPI does not infer from exceptions.", "",
        "| Method | Path | Summary | Tags |", "|---|---|---|---|",
    ]
    for path, method, operation in operations:
        target = anchor(f"{method}-{path}")
        summary = operation.get("summary") or operation.get("operationId", "")
        lines.append(f"| {method.upper()} | [`{path}`](#{target}) | {cell(summary)} | {cell(', '.join(operation.get('tags', [])))} |")
    for path, method, operation in operations:
        lines += ["", f"## {method.upper()} `{path}` {{ #{anchor(f'{method}-{path}')} }}", ""]
        if operation.get("description"):
            lines += [operation["description"], ""]
        parameters = schema.get("paths", {}).get(path, {}).get("parameters", []) + operation.get("parameters", [])
        if parameters:
            lines += ["### Parameters", "", "| Name | Location | Required | Schema | Details |",
                      "|---|---|---|---|---|"]
            for parameter in parameters:
                shape = parameter.get("schema", {})
                notes = "; ".join(filter(None, [cell(parameter.get("description", "")), schema_notes(shape)]))
                lines.append(f"| `{cell(parameter.get('name', ''))}` | {cell(parameter.get('in', ''))} | {bool(parameter.get('required'))} | {schema_type(shape)} | {notes} |")
            lines.append("")
        body = operation.get("requestBody")
        if body:
            lines += ["### Request body", "", f"Required: **{bool(body.get('required'))}**.", ""]
            if body.get("description"):
                lines += [body["description"], ""]
            for media, content in body.get("content", {}).items():
                lines += [f"Content type: `{media}`. Schema: {schema_type(content.get('schema', {}))}.", ""]
        lines += ["### Declared responses", "", "| Status | Description | Content type | Schema |",
                  "|---|---|---|---|"]
        for status, response in operation.get("responses", {}).items():
            for media, content in (response.get("content") or {"—": {}}).items():
                shape = schema_type(content["schema"]) if content.get("schema") else "Not declared"
                lines.append(f"| {status} | {cell(response.get('description', ''))} | {cell(media)} | {shape} |")
    lines += ["", "## Data schemas", "",
              "Required means the field must be present; nullable means its value may be `null`.",
              "A default is not a validation limit. Expand the JSON definition for the exact schema.", ""]
    for name, shape in sorted(schema.get("components", {}).get("schemas", {}).items()):
        lines += [f"### {name} {{ #schema-{anchor(name)} }}", ""]
        if shape.get("description"):
            lines += [shape["description"], ""]
        if shape.get("properties"):
            lines += ["| Field | Required | Schema | Details |", "|---|---|---|---|"]
            for field, definition in shape["properties"].items():
                lines.append(f"| `{cell(field)}` | {field in shape.get('required', [])} | {schema_type(definition)} | {schema_notes(definition)} |")
            lines.append("")
        lines += ['<details markdown="1">', "<summary>JSON schema definition</summary>", "",
                  "```json", json.dumps(shape, indent=2, ensure_ascii=False), "```", "", "</details>", ""]
    lines += ["Raw schema: [backend-openapi.json](backend-openapi.json)", ""]
    return "\n".join(lines)
