"""Start the installed Blender MCP bridge in a normal Blender GUI process.

Run from the repository root:
  blender --factory-startup --python tools/blender/start_mcp.py

The add-on refuses background mode because Blender must service commands on its
main thread. This helper locates the installed add-on without a machine-specific
path and leaves the GUI process running as the bridge host.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import bpy


def addon_path() -> Path:
    for scripts in bpy.utils.script_paths():
        candidate = Path(scripts) / "addons" / "blender_mcp_addon.py"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("blender_mcp_addon.py is not installed")


path = addon_path()
spec = importlib.util.spec_from_file_location("blender_mcp_addon", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)
module.register()
