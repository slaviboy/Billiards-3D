# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Exports the models of pool.blend for the game:

    public/models/table-9ft.glb, public/models/table-7ft.glb   each table, its parts as named nodes
    public/models/cue.glb                                      the cue, its tip at the origin

+Y up (glTF), so the scene frame of src/table/frame.ts; plain materials named as in materials.py
(the game adds the cloth's weave and the wood's grain itself); no textures, cameras or lights.

Run: blender -b blender/pool.blend --python-exit-code 1 -P blender/scripts/export_glb.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import common


def export(objects, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_vertex_color="NONE",
        export_draco_mesh_compression_enable=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        check_existing=False,
    )
    print("exported", path, os.path.getsize(path), "bytes")


def main():
    out = os.path.join(common.ROOT, "public", "models")
    os.makedirs(out, exist_ok=True)
    layers = bpy.context.view_layer.layer_collection.children
    for size in ("9ft", "7ft"):
        name = f"table-{size}"
        layers[name].exclude = False
        export(list(bpy.data.collections[name].objects), os.path.join(out, f"{name}.glb"))
    export([bpy.data.objects["cue"]], os.path.join(out, "cue.glb"))


main()
