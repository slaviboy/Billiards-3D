# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Builds a pool table from blender/table-geometry-<size>.json (written from src/table/).

The cushions are the rubber's cross-section swept along the exact nose outline the simulation uses
(straight noses, the rounded lips, the pocket facings), with the nose point of the profile on the
outline itself, so a ball bounces where the cushion is drawn. Around them: the slate bed with the
pocket cuts, the wooden rails with their pocket openings and sights, the pocket liners and drop
pockets, the apron and the legs.

Objects are named "<size>-<part>" (e.g. "9ft-cushion-3"), each at the origin with no transform.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy

import common
import materials

SLATE = 0.0254
APRON_TOP = -0.045
APRON_BOTTOM = -0.17
CUP_DEPTH = 0.115


def load(size):
    with open(os.path.join(common.ROOT, "blender", f"table-geometry-{size}.json")) as f:
        return json.load(f)


def link(obj, collection, material_names):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)
    obj.data.materials.clear()
    for name in material_names:
        obj.data.materials.append(materials.material(name))
    return obj


def mesh_object(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cushion_path(geo, cushion):
    """Points along a cushion's nose outline with the unit direction into the rubber at each."""
    W, L = geo["W"], geo["L"]
    normals = {s["id"]: s["normal"] for s in geo["physics"]["linear"]}
    rail = cushion["rail"]
    points = []

    def add(x, y, dx, dy):
        p = (x - W / 2, y - L / 2, dx, dy)
        if points and abs(points[-1][0] - p[0]) < 1e-12 and abs(points[-1][1] - p[1]) < 1e-12:
            return
        points.append(p)

    for k, piece in enumerate(cushion["path"]):
        if "line" in piece:
            (ax, ay), (bx, by) = piece["line"]
            if k == 2:
                dx, dy = cushion["back"]
            else:
                facing = 6 + rail * 2 + (0 if k == 0 else 1)
                nx, ny = normals[facing]
                dx, dy = -nx, -ny
            add(ax, ay, dx, dy)
            add(bx, by, dx, dy)
        else:
            arc = piece["arc"]
            cx, cy = arc["center"]
            r = arc["radius"]
            a0 = math.atan2(arc["from"][1] - cy, arc["from"][0] - cx)
            a1 = math.atan2(arc["to"][1] - cy, arc["to"][0] - cx)
            if arc["ccw"] and a1 < a0:
                a1 += 2 * math.pi
            if not arc["ccw"] and a1 > a0:
                a1 -= 2 * math.pi
            steps = 12
            for i in range(steps + 1):
                a = a0 + (a1 - a0) * i / steps
                if i == 0:
                    x, y = arc["from"]
                elif i == steps:
                    x, y = arc["to"]
                else:
                    x, y = cx + r * math.cos(a), cy + r * math.sin(a)
                # Into the rubber: toward the lip circle's centre.
                d = math.hypot(cx - x, cy - y)
                add(x, y, (cx - x) / d, (cy - y) / d)
    return points


def cushion(geo, cushion_spec, name):
    """The rubber, cloth-covered: the profile swept along the nose outline, its ends capped."""
    profile = geo["profile"]
    n = len(profile)
    verts, faces = [], []
    path = cushion_path(geo, cushion_spec)
    for x, y, dx, dy in path:
        for d, z in profile:
            verts.append((x + d * dx, y + d * dy, z))
    for i in range(len(path) - 1):
        for j in range(n):
            a = i * n + j
            b = i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    faces.append(tuple(range(n - 1, -1, -1)))
    last = (len(path) - 1) * n
    faces.append(tuple(last + j for j in range(n)))
    obj = mesh_object(name, verts, faces)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def slab(name, x0, y0, x1, y1, z0, z1):
    return common.box(
        name, ((x1 - x0), (y1 - y0), (z1 - z0)), location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    )


def cut_circles(obj, circles, z0, z1, segments=64):
    """Bores vertical round holes through an object."""
    for i, (cx, cy, r) in enumerate(circles):
        cutter = common.cylinder(
            f"cutter-{i}", r, z1 - z0, location=(cx, cy, (z0 + z1) / 2), segments=segments
        )
        common.boolean(obj, cutter)


def build(size, collection_name=None):
    geo = load(size)
    W, L, h = geo["W"], geo["L"], geo["noseHeight"]
    cw, rw, rh = geo["cushionWidth"], geo["railWidth"], geo["railHeight"]
    collection = common.ensure_collection(collection_name or f"table-{size}")
    pockets = [(p["center"][0] - W / 2, p["center"][1] - L / 2, p["radius"]) for p in geo["pockets"]]

    # The slate bed under the cloth, reaching under the cushions to their backs, with the pockets'
    # slate cuts bored through it.
    bed = slab(f"{size}-bed", -W / 2 - cw, -L / 2 - cw, W / 2 + cw, L / 2 + cw, -SLATE, 0.0)
    cut_circles(bed, pockets, -SLATE - 0.01, 0.01)
    link(bed, collection, ["cloth"])

    for c in geo["cushions"]:
        link(cushion(geo, c, f"{size}-cushion-{c['rail']}"), collection, ["cloth"])

    # The rails: a wooden frame from the cushions' backs to the outer edge, with an opening above
    # each pocket a little wider than its slate cut.
    outer = slab("rail-outer", -W / 2 - rw, -L / 2 - rw, W / 2 + rw, L / 2 + rw, APRON_TOP, rh)
    inner = slab("rail-inner", -W / 2 - cw, -L / 2 - cw, W / 2 + cw, L / 2 + cw, APRON_TOP - 0.01, rh + 0.01)
    common.boolean(outer, inner)
    cut_circles(outer, [(x, y, r + 0.004) for x, y, r in pockets], APRON_TOP - 0.01, rh + 0.01)
    outer.name = f"{size}-rails"
    link(outer, collection, ["rail-wood"])

    # Pocket liners (rubber rings lining the rail openings, lipped over the rail tops) and the
    # leather drop pockets below them, both open, so a pocketed ball falls inside.
    parts = []
    for i, (x, y, r) in enumerate(pockets):
        ri, ro = r + 0.002, r + 0.004
        liner = ring_lathe(
            f"liner-{i}",
            [(ri, APRON_TOP), (ro, APRON_TOP), (ro, rh - 0.0006), (ro + 0.005, rh - 0.0006),
             (ro + 0.005, rh + 0.0004), (ro + 0.003, rh + 0.0012), (ri, rh + 0.0012)],
        )
        top = APRON_TOP + 0.004
        bottom = APRON_TOP - CUP_DEPTH
        cup = ring_lathe(
            f"cup-{i}",
            [(r + 0.001, top), (r + 0.001, bottom + 0.045), (r * 0.62, bottom), (0.002, bottom - 0.002),
             (0.002, bottom + 0.002), (r * 0.6, bottom + 0.004), (r - 0.002, bottom + 0.045),
             (r - 0.002, top)],
        )
        for part in (liner, cup):
            part.data.transform(common.Matrix.Translation((x, y, 0.0)))
        parts.append((liner, "liner"))
        parts.append((cup, "pocket"))
    liners = common.join(parts[0][0], [p for p, kind in parts[1:] if kind == "liner"])
    liners.name = f"{size}-liners"
    link(liners, collection, ["liner"])
    cups = [p for p, kind in parts if kind == "pocket"]
    cups = common.join(cups[0], cups[1:])
    cups.name = f"{size}-pockets"
    link(cups, collection, ["pocket"])

    # Sights: mother-of-pearl dots set in the rail tops.
    sight_parts = []
    for i, (sx, sy) in enumerate(geo["sights"]):
        sight_parts.append(
            common.cylinder(f"sight-{i}", 0.00635, 0.0012, location=(sx - W / 2, sy - L / 2, rh - 0.0003), segments=20)
        )
    sights = common.join(sight_parts[0], sight_parts[1:])
    sights.name = f"{size}-sights"
    link(sights, collection, ["sight"])

    # The foot spot.
    fx, fy = geo["spots"]["foot"]
    spot = common.cylinder(f"{size}-spot", 0.006, 0.0004, location=(fx - W / 2, fy - L / 2, 0.0002), segments=24)
    link(spot, collection, ["spot"])

    # The apron below the rails.
    apron = slab("apron-outer", -W / 2 - rw + 0.004, -L / 2 - rw + 0.004, W / 2 + rw - 0.004, L / 2 + rw - 0.004,
                 APRON_BOTTOM, APRON_TOP + 0.001)
    hollow = slab("apron-inner", -W / 2 - rw + 0.03, -L / 2 - rw + 0.03, W / 2 + rw - 0.03, L / 2 + rw - 0.03,
                  APRON_BOTTOM - 0.01, APRON_TOP + 0.01)
    common.boolean(apron, hollow)
    apron.name = f"{size}-apron"
    link(apron, collection, ["apron-wood"])

    # Tapered legs: six under a 9-ft table, four under a 7-ft one; levelling feet below.
    floor = -geo["bedHeight"]
    lx = W / 2 + rw - 0.13
    ly = L / 2 + rw - 0.26
    spots = [(sx * lx, sy * ly) for sx in (-1, 1) for sy in (-1, 1)]
    if size == "9ft":
        spots += [(-lx, 0.0), (lx, 0.0)]
    leg_parts, feet = [], []
    for i, (x, y) in enumerate(spots):
        leg = leg_mesh(f"leg-{i}", x, y, APRON_BOTTOM + 0.002, floor + 0.012)
        leg_parts.append(leg)
        feet.append(common.cylinder(f"foot-{i}", 0.026, 0.012, location=(x, y, floor + 0.006), segments=24))
    legs = common.join(leg_parts[0], leg_parts[1:])
    legs.name = f"{size}-legs"
    link(legs, collection, ["leg-wood"])
    feet = common.join(feet[0], feet[1:])
    feet.name = f"{size}-feet"
    link(feet, collection, ["metal"])

    for obj in collection.objects:
        # Positions baked into the meshes: every part sits at the origin, in the table's frame.
        common.apply_transforms(obj)
        common.smooth_by_angle(obj, 40.0)
    return collection


def ring_lathe(name, profile, steps=48):
    """Spins a closed cross-section (r, z) around the Z axis into a ring, open in the middle."""
    n = len(profile)
    verts, faces = [], []
    for s in range(steps):
        a = 2 * math.pi * s / steps
        ca, sa = math.cos(a), math.sin(a)
        for r, z in profile:
            verts.append((r * ca, r * sa, z))
    for s in range(steps):
        t = (s + 1) % steps
        for j in range(n):
            k = (j + 1) % n
            faces.append((s * n + j, s * n + k, t * n + k, t * n + j))
    obj = mesh_object(name, verts, faces)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def leg_mesh(name, x, y, top, bottom):
    """A square leg tapering from 11 cm at the top to 8 cm at the foot."""
    a, b = 0.055, 0.04
    verts = [
        (x - a, y - a, top), (x + a, y - a, top), (x + a, y + a, top), (x - a, y + a, top),
        (x - b, y - b, bottom), (x + b, y - b, bottom), (x + b, y + b, bottom), (x - b, y + b, bottom),
    ]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return mesh_object(name, verts, faces)
