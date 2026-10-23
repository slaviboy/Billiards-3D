# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""The materials of the table, the cue and the balls.

Each is a plain Principled BSDF (colour, roughness, metal, clear coat), which glTF carries as it
is; the game adds the cloth's weave and the wood's grain in its own shaders, keyed by the material's
name. The preview renders add the same kind of detail with procedural nodes (render_previews.py).
Colours are given in sRGB, as picked from the reference photographs, and converted to Blender's
linear values here.
"""

import bpy

# name: (sRGB colour, roughness, metallic, clear coat)
SPECS = {
    "cloth": ((0.07, 0.34, 0.32), 0.93, 0.0, 0.0),
    "rail-wood": ((0.26, 0.095, 0.045), 0.38, 0.0, 0.7),
    "apron-wood": ((0.23, 0.085, 0.04), 0.4, 0.0, 0.6),
    "leg-wood": ((0.21, 0.08, 0.037), 0.42, 0.0, 0.5),
    "sight": ((0.93, 0.91, 0.85), 0.22, 0.0, 0.6),
    "leather": ((0.72, 0.52, 0.36), 0.55, 0.0, 0.15),
    "net": ((0.86, 0.85, 0.80), 0.9, 0.0, 0.0),
    "spot": ((0.88, 0.88, 0.83), 0.8, 0.0, 0.0),
    "cue-tip": ((0.22, 0.30, 0.48), 0.85, 0.0, 0.0),
    "cue-ferrule": ((0.94, 0.92, 0.87), 0.25, 0.0, 0.5),
    "cue-shaft": ((0.87, 0.74, 0.54), 0.33, 0.0, 0.6),
    "cue-collar": ((0.80, 0.80, 0.82), 0.25, 1.0, 0.0),
    "cue-forearm": ((0.13, 0.055, 0.03), 0.3, 0.0, 0.8),
    "cue-ring": ((0.82, 0.82, 0.84), 0.2, 1.0, 0.0),
    "cue-wrap": ((0.045, 0.045, 0.05), 0.9, 0.0, 0.0),
    "cue-sleeve": ((0.13, 0.055, 0.03), 0.3, 0.0, 0.8),
    "cue-cap": ((0.035, 0.035, 0.035), 0.35, 0.0, 0.5),
    "cue-bumper": ((0.02, 0.02, 0.02), 0.8, 0.0, 0.0),
}


def linear(c):
    """sRGB (0-1) to linear."""
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def material(name):
    """The named material, created once."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    colour, roughness, metallic, coat = SPECS[name]
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*linear(colour), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    mat.diffuse_color = (*linear(colour), 1.0)
    return mat


def ball_material(n, image_path):
    """A ball: its painted markings under a glossy phenolic finish."""
    name = f"ball-{n}"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.03
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(image_path, check_existing=True)
    texture.interpolation = "Cubic"
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    return mat
