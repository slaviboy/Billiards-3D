# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Renders the reference views of pool.blend into blender/renders/, to check the models against
the research (docs/visual-research.md) before they go into the game:

    table-top.jpg            the 9-ft table from straight above, racked
    table-three-quarter.jpg  from a corner, the cue ready behind the cue ball
    pocket-closeup.jpg       a corner pocket's jaws, facings, liner and a ball at the lip
    cue-tip.jpg              the cue's tip, ferrule and shaft at the cue ball
    balls-lineup.jpg         the sixteen balls in a row
    game-lighting.jpg        the table under the game's lighting, from the game's camera

Lit like a pool room: three rectangular lamps 1 m above the bed (the WPA minimum for a movable
fixture is 40 in), a dark room. EEVEE with the Standard view transform. The materials gain a
cloth weave and wood grain for these renders; the exported models keep plain materials.

Run: blender -b blender/pool.blend --python-exit-code 1 -P blender/scripts/render_previews.py
"""

import math
import random
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import common

R = 0.028575
STAMP_FIELDS = (
    "camera", "date", "filename", "frame", "frame_range", "hostname", "lens", "marker", "memory",
    "note", "render_time", "scene", "sequencer_strip", "time",
)


def detail_materials():
    """Weave in the cloth and grain in the wood, for the renders only."""
    cloth = bpy.data.materials["cloth"]
    nodes, links = cloth.node_tree.nodes, cloth.node_tree.links
    bsdf = nodes["Principled BSDF"]
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    noise.inputs["Detail"].default_value = 3.0
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.0004
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Sheen Weight"].default_value = 0.35
    bsdf.inputs["Sheen Roughness"].default_value = 0.5
    for name in ("rail-wood", "apron-wood", "leg-wood", "cue-forearm", "cue-sleeve", "cue-shaft"):
        mat = bpy.data.materials[name]
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes["Principled BSDF"]
        base = tuple(bsdf.inputs["Base Color"].default_value)
        wave = nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "X" if name.startswith("cue") else "Y"
        wave.inputs["Scale"].default_value = 3.0 if name.startswith("cue") else 9.0
        wave.inputs["Distortion"].default_value = 6.0
        wave.inputs["Detail"].default_value = 4.0
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = tuple(c * 0.72 for c in base[:3]) + (1.0,)
        ramp.color_ramp.elements[1].color = tuple(min(1.0, c * 1.15) for c in base[:3]) + (1.0,)
        links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])


def setup(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.eevee.taa_render_samples = 64
    world = bpy.data.worlds.get("room") or bpy.data.worlds.new("room")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.012, 0.013, 0.016, 1.0)
    background.inputs["Strength"].default_value = 1.0

    # Three lamps over the table, along its length, 1 m above the bed.
    for i, y in enumerate((-0.85, 0.0, 0.85)):
        lamp = bpy.data.lights.new(f"lamp-{i}", "AREA")
        lamp.shape = "RECTANGLE"
        lamp.size = 0.42
        lamp.size_y = 0.3
        lamp.energy = 7.0
        lamp.color = (1.0, 0.95, 0.86)
        obj = bpy.data.objects.new(f"lamp-{i}", lamp)
        obj.location = (0.0, y, 1.0)
        scene.collection.objects.link(obj)
    # A faint fill from the room.
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
    fill.data.energy = 0.25
    fill.rotation_euler = (math.radians(55), 0, math.radians(30))
    scene.collection.objects.link(fill)

    floor = bpy.data.objects.new("floor", bpy.data.meshes.new("floor"))
    z = -0.762
    floor.data.from_pydata([(-6, -6, z), (6, -6, z), (6, 6, z), (-6, 6, z)], [], [(0, 1, 2, 3)])
    floor_mat = bpy.data.materials.new("floor")
    if floor_mat.node_tree is None:
        floor_mat.use_nodes = True
    floor_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.03, 0.025, 0.022, 1)
    floor_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    floor.data.materials.append(floor_mat)
    scene.collection.objects.link(floor)

    camera = bpy.data.objects.new("preview-camera", bpy.data.cameras.new("preview-camera"))
    camera.data.clip_start = 0.005
    camera.data.clip_end = 30
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def look(camera, location, target, lens=None, ortho=None):
    camera.location = location
    direction = Vector(target) - Vector(location)
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if ortho:
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = ortho
    else:
        camera.data.type = "PERSP"
        camera.data.lens = lens or 35


def render(scene, path, width=1600, height=900):
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.use_stamp = False
    for field in STAMP_FIELDS:
        setattr(scene.render, "use_stamp_" + field, False)
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def place(ball, x, y, spin=0.0, tilt=0.0, roll=0.0):
    ball.location = (x, y, R)
    ball.rotation_euler = (tilt, roll, spin)
    ball.hide_render = False


def rack(balls, foot_y):
    """A racked triangle at the 9-ft table's foot spot, in the WPA arrangement, each ball turned
    at random (seeded), as real balls lie."""
    turn = random.Random(8)
    order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15]
    spacing = 2 * R * 1.001
    k = 0
    for row in range(5):
        for i in range(row + 1):
            n = order[k]
            k += 1
            place(balls[n], (i - row / 2) * spacing, foot_y + row * spacing * math.sqrt(3) / 2,
                  spin=turn.uniform(0, 2 * math.pi), tilt=turn.uniform(-1.4, 1.4), roll=turn.uniform(-0.6, 0.6))


def aim_cue(cue, ball_x, ball_y, heading, elevation_deg=4.0, gap=0.012):
    """Puts the cue behind a ball, pointing along `heading` (radians, on the table)."""
    dx, dy = math.cos(heading), math.sin(heading)
    tip = Vector((ball_x - dx * (R + gap), ball_y - dy * (R + gap), R))
    back = Vector((-dx * math.cos(math.radians(elevation_deg)), -dy * math.cos(math.radians(elevation_deg)),
                   math.sin(math.radians(elevation_deg))))
    cue.location = tip
    cue.rotation_euler = back.to_track_quat("Z", "X").to_euler()
    cue.hide_render = False


def main():
    scene = bpy.context.scene
    detail_materials()
    camera = setup(scene)
    out = os.path.join(common.ROOT, "blender", "renders")
    os.makedirs(out, exist_ok=True)
    balls = [bpy.data.objects[f"ball-{n}"] for n in range(16)]
    cue = bpy.data.objects["cue"]
    L = 2.54
    foot_y = L / 4

    # 1. The whole table from straight above, racked, the cue ball on the head string's side.
    rack(balls, foot_y)
    place(balls[0], 0.0, -L / 4 - 0.12)
    cue.hide_render = True
    look(camera, (0.0, 0.0, 4.0), (0.0, 0.0, 0.0), ortho=3.2)
    camera.rotation_euler = (0.0, 0.0, math.radians(90))
    render(scene, os.path.join(out, "table-top.jpg"))

    # 2. Three-quarter view from the head-right corner, the cue ready.
    aim_cue(cue, 0.0, -L / 4 - 0.12, math.radians(90))
    look(camera, (1.75, -2.55, 1.35), (0.0, -0.1, -0.15), lens=32)
    render(scene, os.path.join(out, "table-three-quarter.jpg"))

    # 3. A corner pocket close up (head-left), a ball resting at its jaw.
    corner = Vector((-1.27 / 2, -L / 2, 0.0))
    place(balls[3], corner.x + 0.075, corner.y + 0.03, spin=0.9)
    look(camera, (corner.x + 0.42, corner.y + 0.36, 0.2), (corner.x + 0.02, corner.y + 0.02, 0.0), lens=45)
    render(scene, os.path.join(out, "pocket-closeup.jpg"))
    place(balls[3], 0.0, 0.0)
    rack(balls, foot_y)

    # 4. The cue's tip at the cue ball.
    place(balls[0], 0.2, -0.6, spin=0.3)
    aim_cue(cue, 0.2, -0.6, math.radians(90), elevation_deg=3.0, gap=0.006)
    look(camera, (0.38, -0.66, 0.06), (0.2, -0.64, R), lens=70)
    render(scene, os.path.join(out, "cue-tip.jpg"))

    # 5. The sixteen balls in a row on the cloth.
    cue.hide_render = True
    for n, ball in enumerate(balls):
        place(ball, (n - 7.5) * 2.4 * R, 0.0)
    look(camera, (0.0, -0.95, 0.32), (0.0, 0.0, R), lens=60)
    render(scene, os.path.join(out, "balls-lineup.jpg"))

    # 6. The game's view: from behind the head rail, under the lamps, ready to break.
    rack(balls, foot_y)
    place(balls[0], 0.05, -L / 4 - 0.12)
    aim_cue(cue, 0.05, -L / 4 - 0.12, math.atan2(foot_y + L / 4 + 0.12, -0.05))
    look(camera, (0.0, -2.75, 1.55), (0.0, 0.15, 0.0), lens=30)
    render(scene, os.path.join(out, "game-lighting.jpg"))


main()
