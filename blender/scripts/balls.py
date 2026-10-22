# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""The ball set, for the reference renders: sixteen spheres of radius 0.028575 m with the markings
painted by scripts/export-ball-textures.ts (from src/balls/markings.ts). The game draws its balls
itself, from the same definition, so these are not exported.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy

import common
import materials

R = 0.028575


def build(collection_name="balls"):
    collection = common.ensure_collection(collection_name)
    balls = []
    for n in range(16):
        mesh = bpy.data.meshes.new(f"ball-{n}")
        bm = bmesh.new()
        # calc_uvs fills an existing UV layer only.
        bm.loops.layers.uv.new("UVMap")
        bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=R, calc_uvs=True)
        bm.to_mesh(mesh)
        bm.free()
        for poly in mesh.polygons:
            poly.use_smooth = True
        obj = bpy.data.objects.new(f"ball-{n}", mesh)
        collection.objects.link(obj)
        # Relative to the saved .blend (build.py saves it first), so no local folder is recorded.
        image = f"//textures/ball-{n}.png"
        obj.data.materials.append(materials.ball_material(n, image))
        balls.append(obj)
    return balls
