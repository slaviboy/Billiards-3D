# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Turns the cue from blender/cue-spec.json (written from src/cue/spec.ts).

Each part (tip, ferrule, shaft, joint collar, forearm, rings, wrap, sleeve, butt cap, bumper) is a
lathe of its profile around the Z axis; they are joined into one object, "cue", one material per
part. The tip's end is at the origin and the cue runs up +Z (+Y after glTF export), so the game
places it by its tip and turns it along the aim.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common
import materials


def build(collection_name="cue"):
    with open(os.path.join(common.ROOT, "blender", "cue-spec.json")) as f:
        spec = json.load(f)
    collection = common.ensure_collection(collection_name)
    parts = []
    for part in spec["parts"]:
        # The spec gives (distance along the cue, radius); the lathe takes (radius, height).
        profile = [(r, d) for d, r in part["profile"]]
        obj = common.lathe(part["name"], profile, steps=40)
        obj.data.materials.append(materials.material(part["material"]))
        parts.append(obj)
    cue = common.join(parts[0], parts[1:])
    cue.name = "cue"
    cue.data.name = "cue"
    common.move_to_collection(cue, collection)
    common.smooth_by_angle(cue, 30.0)
    return cue
