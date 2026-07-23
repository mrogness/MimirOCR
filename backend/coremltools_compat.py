"""Compatibility shim for macOS frozen sidecar runtime.

This module installs a minimal `coremltools` surface required by Kraken model
loading without importing full coremltools converters (which can pull in
TensorFlow and trigger protobuf descriptor collisions in frozen builds).
"""

from __future__ import annotations

import importlib
import importlib.util
import os
from pathlib import Path
import sys
import types
from typing import Any


def _should_install_shim() -> bool:
    if os.getenv("MIMIR_USE_REAL_COREMLTOOLS", "0") == "1":
        return False

    if os.getenv("MIMIR_FORCE_COREMLTOOLS_SHIM", "0") == "1":
        return True

    return sys.platform == "darwin" and bool(getattr(sys, "frozen", False))


def _coremltools_root() -> Path:
    spec = importlib.util.find_spec("coremltools")
    if not spec or not spec.submodule_search_locations:
        raise ImportError("coremltools package metadata not found")

    root = Path(next(iter(spec.submodule_search_locations))).resolve()
    if not root.exists():
        raise ImportError(f"coremltools path does not exist: {root}")
    return root


def _load_model_spec(model_ref: Any):
    # Imported lazily to keep startup minimal.
    from google.protobuf.message import DecodeError

    model_pb2 = importlib.import_module("coremltools.proto.Model_pb2")

    if hasattr(model_ref, "description") and hasattr(model_ref, "SerializeToString"):
        return model_ref

    path = Path(str(model_ref)).expanduser()
    if path.is_dir():
        path = path / "model.mlmodel"

    if not path.exists():
        raise FileNotFoundError(str(path))

    spec = model_pb2.Model()
    payload = path.read_bytes()
    try:
        spec.ParseFromString(payload)
    except DecodeError as exc:
        raise TypeError(f"Failed parsing CoreML model: {path}") from exc
    return spec


def install_coremltools_shim_if_needed() -> bool:
    """Install shimmed coremltools modules for macOS frozen sidecar runtime."""
    if not _should_install_shim():
        return False

    existing = sys.modules.get("coremltools")
    if existing is not None:
        if bool(getattr(existing, "__mimir_coreml_shim__", False)):
            return True

        # In frozen macOS runtime we must avoid real coremltools imports.
        # If something imported it early, evict those modules and replace with
        # shimmed modules before Kraken import paths run.
        for name in list(sys.modules.keys()):
            if name == "coremltools" or name.startswith("coremltools."):
                sys.modules.pop(name, None)

    root = _coremltools_root()
    proto_root = root / "proto"

    coremltools_mod = types.ModuleType("coremltools")
    coremltools_mod.__path__ = [str(root)]
    setattr(coremltools_mod, "__mimir_coreml_shim__", True)

    proto_mod = types.ModuleType("coremltools.proto")
    proto_mod.__path__ = [str(proto_root)]

    models_mod = types.ModuleType("coremltools.models")
    models_mod.__path__ = []

    neural_mod = types.ModuleType("coremltools.models.neural_network")

    class MLModel:
        """Minimal Kraken-compatible CoreML model wrapper."""

        def __init__(self, model: Any, *args, **kwargs) -> None:
            del args, kwargs
            self._spec = _load_model_spec(model)

        @property
        def user_defined_metadata(self):
            return self._spec.description.metadata.userDefined

        def get_spec(self):
            return self._spec

    class _DataTypes:
        @staticmethod
        def Array(*shape):
            return tuple(shape)

        @staticmethod
        def String():
            return "string"

    class NeuralNetworkBuilder:
        def __init__(self, *_args, **_kwargs) -> None:
            raise RuntimeError(
                "NeuralNetworkBuilder is unavailable in Mimir frozen-runtime shim"
            )

    setattr(models_mod, "MLModel", MLModel)
    setattr(models_mod, "datatypes", _DataTypes())
    setattr(neural_mod, "NeuralNetworkBuilder", NeuralNetworkBuilder)
    setattr(models_mod, "neural_network", neural_mod)

    inserted = []
    try:
        sys.modules["coremltools"] = coremltools_mod
        inserted.append("coremltools")
        sys.modules["coremltools.proto"] = proto_mod
        inserted.append("coremltools.proto")
        sys.modules["coremltools.models"] = models_mod
        inserted.append("coremltools.models")
        sys.modules["coremltools.models.neural_network"] = neural_mod
        inserted.append("coremltools.models.neural_network")

        # Load protobuf-backed modules from coremltools/proto without importing
        # coremltools.__init__ (which pulls optional converter dependencies).
        model_pb2 = importlib.import_module("coremltools.proto.Model_pb2")
        nn_pb2 = importlib.import_module("coremltools.proto.NeuralNetwork_pb2")

        setattr(proto_mod, "Model_pb2", model_pb2)
        setattr(proto_mod, "NeuralNetwork_pb2", nn_pb2)
        setattr(coremltools_mod, "proto", proto_mod)
        setattr(coremltools_mod, "models", models_mod)
    except Exception:
        for name in reversed(inserted):
            sys.modules.pop(name, None)
        raise

    return True
