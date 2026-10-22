# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Builds blender/pool.blend: both tables, the cue and the ball set.

Run (or `npm run models`, which first writes the geometry, cue and texture files this reads):
    blender --background --factory-startup --python-exit-code 1 --python blender/scripts/build.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import balls
import common
import cue
import table


def main():
    common.reset_scene()
    # Saved empty first, so "//" paths mean blender/: the ball textures are loaded by relative
    # paths and no folder of this computer is ever recorded in the file.
    path = os.path.join(common.ROOT, "blender", "pool.blend")
    common.save_blend(path)
    table.build("9ft")
    seven = table.build("7ft")
    # One table at a time in the scene's view; the 7-ft one waits hidden.
    layer = bpy.context.view_layer.layer_collection.children[seven.name]
    layer.exclude = True
    cue.build()
    balls.build()
    # The ball textures go inside the file, so it opens anywhere. Packing records the absolute
    # path packed from; it is replaced by the relative one (the field filled with spaces first, so
    # no bytes of the old path survive after the new one's end).
    bpy.ops.file.pack_all()
    for image in bpy.data.images:
        for packed in image.packed_files:
            packed.filepath = " " * 1023
            packed.filepath = image.filepath.replace("\\", "/")
    common.save_blend(path)
    print("saved", path)


main()
