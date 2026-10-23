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
pocket cuts, the wooden rails with their sights, the pockets' leather covers and nets, the apron and
the turned legs. The frame's corners are rounded about the corner pockets, which the leathers wrap.

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
APRON_BOTTOM = -0.215
NET_DEPTH = 0.115
# The apron's face, set back from the rail cap's edge.
APRON_INSET = 0.004
# The square block at the top of each leg, below the apron.
BLOCK = 0.13
BLOCK_HEIGHT = 0.15


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

    # The rails: the wooden cap from the cushions' backs to the frame's edge, its outer edge
    # rounded over a lip, swept round the frame's outline; each pocket's leather takes its place
    # around the pocket.
    rails = sweep_ring("rail-ring", frame_outline(geo), rail_profile(rw, cw, rh))
    shapes = [pocket_shape(geo, p) for p in geo["pockets"]]
    for i, shape in enumerate(shapes):
        common.boolean(rails, leather_cutter(f"rail-cut-{i}", shape, rh))
    rails.name = f"{size}-rails"
    link(rails, collection, ["rail-wood"])

    # The pockets: a leather cover over each, and a net hanging below it.
    leathers = [leather(f"leather-{i}", geo, shape, rh) for i, shape in enumerate(shapes)]
    leathers = common.join(leathers[0], leathers[1:])
    leathers.name = f"{size}-leathers"
    link(leathers, collection, ["leather"])
    nets = [net(f"net-{i}", shape) for i, shape in enumerate(shapes)]
    nets = common.join(nets[0], nets[1:])
    nets.name = f"{size}-nets"
    link(nets, collection, ["net"])

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

    # The apron below the rails, round the same outline, a bead along its foot. Under each side
    # pocket it is notched for the net to hang in, and closed behind by a curved board.
    apron = sweep_ring("apron-ring", frame_outline(geo), APRON_PROFILE)
    boards = []
    for i, shape in enumerate(s for s in shapes if not s["corner"]):
        cx, cy = shape["center"]
        nx, ny = shape["axis"]
        notch = shape["hole"] + NET_BULGE + NOTCH_ROOM
        face = outer_distance(geo, cx, cy, nx, ny, APRON_INSET)
        common.boolean(apron, prism(f"notch-{i}", u_outline(cx, cy, nx, ny, notch, 0.3), NOTCH_BOTTOM,
                                    APRON_TOP + 0.01, (cx, cy)))
        board = prism(f"board-{i}", u_outline(cx, cy, nx, ny, notch + 0.012, face - 0.001), NOTCH_BOTTOM,
                      APRON_TOP + 0.001, (cx, cy))
        common.boolean(board, prism(f"board-cut-{i}", u_outline(cx, cy, nx, ny, notch, 0.3), NOTCH_BOTTOM - 0.01,
                                    APRON_TOP + 0.01, (cx, cy)))
        boards.append(board)
    apron = common.join(apron, boards)
    apron.name = f"{size}-apron"
    link(apron, collection, ["apron-wood"])

    # Turned legs under square blocks, along the long sides: at the corners, where the corner's
    # curve ends, and (on a 9-ft table) under the side pockets.
    floor = -geo["bedHeight"]
    corner = geo["pockets"][0]["center"]
    lx = W / 2 + rw - APRON_INSET - BLOCK / 2
    ly = L / 2 - corner[1] - BLOCK / 2
    spots = [(sx * lx, sy * ly) for sx in (-1, 1) for sy in (-1, 1)]
    if size == "9ft":
        spots += [(-lx, 0.0), (lx, 0.0)]
    leg_parts = []
    for i, (x, y) in enumerate(spots):
        leg_parts.append(leg_block(f"block-{i}", x, y))
        leg_parts.append(turned_leg(f"leg-{i}", x, y, floor, APRON_BOTTOM - BLOCK_HEIGHT))
    legs = common.join(leg_parts[0], leg_parts[1:])
    legs.name = f"{size}-legs"
    link(legs, collection, ["leg-wood"])

    for obj in collection.objects:
        # Positions baked into the meshes: every part sits at the origin, in the table's frame.
        common.apply_transforms(obj)
        common.smooth_by_angle(obj, 40.0)
    return collection


def stacked_rings(name, rings, closed=True):
    """A solid from rings of points stacked top to bottom (each ring the same length, in order
    around), capped at both ends with a point in the middle of the end rings."""
    n = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = []
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            faces.append((i * n + j, i * n + k, (i + 1) * n + k, (i + 1) * n + j))
    if closed:
        for ring, base in ((rings[0], 0), (rings[-1], (len(rings) - 1) * n)):
            cx = sum(p[0] for p in ring) / n
            cy = sum(p[1] for p in ring) / n
            verts.append((cx, cy, ring[0][2]))
            centre = len(verts) - 1
            faces.extend((base + j, centre, base + (j + 1) % n) for j in range(n))
    obj = mesh_object(name, verts, faces)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def leg_block(name, x, y):
    """The square block a leg is turned from, below the apron, its lower edge chamfered and
    stepped in to the turning."""
    bottom = APRON_BOTTOM - BLOCK_HEIGHT
    a = BLOCK / 2
    profile = [
        (a, APRON_BOTTOM + 0.002), (a, bottom + 0.018), (a - 0.007, bottom + 0.009),
        (a - 0.012, bottom + 0.009), (a - 0.012, bottom),
    ]
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    return stacked_rings(name, [[(x + sx * h, y + sy * h, z) for sx, sy in corners] for h, z in profile])


# The turned leg, after the photographs of real tables (docs/visual-research.md, section 2.2): a
# collar and a bead under the block, an urn's swelling, a ringed neck, a long fluted taper and a
# moulded foot. (radius, height above the floor) for a leg 0.462 m long, scaled to fit.
LEG_LENGTH = 0.462
LEG = [
    # Collar, cove and bead under the block.
    (0.050, 0.462), (0.057, 0.457), (0.057, 0.446), (0.048, 0.440), (0.043, 0.432), (0.042, 0.427),
    (0.046, 0.423), (0.049, 0.419), (0.049, 0.415), (0.046, 0.411),
    # The urn.
    (0.048, 0.405), (0.054, 0.394), (0.059, 0.380), (0.063, 0.362), (0.064, 0.348), (0.062, 0.330),
    (0.057, 0.312), (0.050, 0.298), (0.043, 0.286), (0.039, 0.278),
    # Neck, ring and the step onto the taper.
    (0.038, 0.274), (0.046, 0.269), (0.046, 0.260), (0.050, 0.255), (0.053, 0.249), (0.052, 0.242),
    # The taper, fluted.
    *((0.052 - 0.016 * i / 9, 0.242 - 0.142 * i / 9) for i in range(1, 10)),
    # Ring, cove, the foot's swelling, a bead and the toe.
    (0.041, 0.095), (0.041, 0.086), (0.037, 0.081), (0.042, 0.071), (0.047, 0.061), (0.050, 0.050),
    (0.048, 0.039), (0.044, 0.031), (0.047, 0.025), (0.047, 0.012), (0.043, 0.005), (0.041, 0.0),
]
LEG_STEPS = 36
FLUTES = 9
FLUTE_DEPTH = 0.004
FLUTED = (0.108, 0.234)


def turned_leg(name, x, y, floor, top):
    """The turned part of a leg, from the floor up to `top`, its taper fluted."""
    scale = (top - floor) / LEG_LENGTH
    groove = [0.0, 0.75, 1.0, 0.75]
    per = LEG_STEPS // FLUTES
    low, high = FLUTED[0] * scale, FLUTED[1] * scale

    def smooth(e0, e1, v):
        t = min(1.0, max(0.0, (v - e0) / (e1 - e0)))
        return t * t * (3 - 2 * t)

    rings = []
    for r, h in LEG:
        h *= scale
        # The flutes stop with rounded ends a little inside the taper.
        depth = FLUTE_DEPTH * smooth(low, low + 0.014, h) * (1 - smooth(high - 0.014, high, h))
        ring = []
        for j in range(LEG_STEPS):
            a = 2 * math.pi * j / LEG_STEPS
            rr = r - depth * groove[(j % per) * len(groove) // per]
            ring.append((x + rr * math.cos(a), y + rr * math.sin(a), floor + h))
        rings.append(ring)
    return stacked_rings(name, rings)


# The frame's outline and the pockets' leathers and nets.
LEATHER_STEPS = 64
# The leather's top above the rail cap, its thickness where it is a skin (the lining, the skirt),
# and the rolls over the hole's edge and along its own outer edge.
LEATHER_LIFT = 0.0012
LEATHER = 0.004
RIM = 0.006
EDGE = 0.004
# How far down the frame's outside a cover hangs, and the lining's foot, where the net hangs from.
SKIRT = APRON_TOP - 0.055
LINING = APRON_TOP - 0.008
# The net: where pocketed balls rest on its floor (src/scene/ShotPlayer.ts), how far it bellies
# out past the hole, and the foot of the notches in the apron under the side pockets.
NET_FLOOR = APRON_TOP - NET_DEPTH + 0.004
NET_BULGE = 0.006
NET_STEPS = 32
NOTCH_BOTTOM = NET_FLOOR - 0.024
# The room left round a side pocket's net in its notch.
NOTCH_ROOM = 0.005

# The apron's cross-section, (distance in from the frame's edge, height): its face, a bead along
# its foot, and its back.
APRON_PROFILE = [
    (APRON_INSET, APRON_TOP + 0.001), (APRON_INSET, APRON_BOTTOM + 0.022),
    (APRON_INSET - 0.003, APRON_BOTTOM + 0.017), (0.0, APRON_BOTTOM + 0.010),
    (APRON_INSET - 0.003, APRON_BOTTOM + 0.003), (APRON_INSET, APRON_BOTTOM),
    (APRON_INSET + 0.026, APRON_BOTTOM), (APRON_INSET + 0.026, APRON_TOP + 0.001),
]


def rail_profile(rw, cw, rh):
    """The rail cap's cross-section, (distance in from the frame's edge, height): from the
    cushion's back across the top to a rounded edge, down a lip, and the rail's face below it."""
    roll = [(0.010 - 0.010 * math.sin(math.radians(a)), rh - 0.010 + 0.010 * math.cos(math.radians(a)))
            for a in (30, 60)]
    return [(rw - cw, APRON_TOP), (rw - cw, rh), (0.010, rh), *roll, (0.0, rh - 0.010), (0.0, rh - 0.028),
            (0.002, rh - 0.030), (0.002, APRON_TOP)]


def corner_centre(geo):
    """How far past the cushion noses (along x and along y) the corner pockets' centres lie."""
    return -geo["pockets"][0]["center"][0]


def frame_outline(geo, arc_steps=12):
    """The frame's outer edge: a rectangle whose corners are rounded about the corner pockets'
    centres, tangent to its sides. Points in order round it, each with its outward normal."""
    W, L, rw = geo["W"], geo["L"], geo["railWidth"]
    e = corner_centre(geo)
    radius = rw - e
    points = []
    for sx, sy, start in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        for k in range(arc_steps + 1):
            a = math.radians(start + 90.0 * k / arc_steps)
            ca, sa = math.cos(a), math.sin(a)
            points.append((sx * (W / 2 + e) + radius * ca, sy * (L / 2 + e) + radius * sa, ca, sa))
    return points


def outer_distance(geo, x, y, dx, dy, inset=0.0):
    """How far from (x, y), along the unit direction (dx, dy), the frame's edge lies (set in by
    `inset`): the nearer of its sides and its rounded corners."""
    W, L, rw = geo["W"], geo["L"], geo["railWidth"]
    e = corner_centre(geo)
    best = math.inf
    for o, d, h in ((x, dx, W / 2 + rw - inset), (y, dy, L / 2 + rw - inset)):
        if d > 1e-12:
            best = min(best, (h - o) / d)
        elif d < -1e-12:
            best = min(best, (-h - o) / d)
    radius = rw - e - inset
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (W / 2 + e), sy * (L / 2 + e)
            fx, fy = x - cx, y - cy
            b = fx * dx + fy * dy
            disc = b * b - (fx * fx + fy * fy - radius * radius)
            if disc < 0:
                continue
            t = -b + math.sqrt(disc)
            # Only the quarter of the circle beyond its centre is the frame's edge.
            if (x + t * dx - cx) * sx >= 0 and (y + t * dy - cy) * sy >= 0:
                best = min(best, t)
    return best


def loft_ring(name, sections):
    """A closed solid from closed cross-sections (each the same number of points, in order round
    it) taken in order round a loop; points shared by neighbouring sections are merged."""
    n = len(sections[0])
    m = len(sections)
    verts = [p for section in sections for p in section]
    faces = []
    for i in range(m):
        i2 = (i + 1) % m
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((i * n + j, i * n + j2, i2 * n + j2, i2 * n + j))
    obj = mesh_object(name, verts, faces)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def sweep_ring(name, outline, profile):
    """A cross-section, (distance in from the outline, height), swept once round an outline."""
    return loft_ring(name, [[(x - o * nx, y - o * ny, z) for o, z in profile] for x, y, nx, ny in outline])


def prism(name, polygon, z0, z1, centre):
    """A vertical prism over a polygon that every ray from `centre` crosses once."""
    n = len(polygon)
    verts = [(x, y, z0) for x, y in polygon] + [(x, y, z1) for x, y in polygon]
    verts += [(centre[0], centre[1], z0), (centre[0], centre[1], z1)]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    faces += [((i + 1) % n, i, 2 * n) for i in range(n)]
    faces += [(n + i, n + (i + 1) % n, 2 * n + 1) for i in range(n)]
    obj = mesh_object(name, verts, faces)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def u_outline(cx, cy, nx, ny, radius, far, steps=16):
    """A U round (cx, cy): a half circle on the side away from the outward direction (nx, ny),
    its arms running out `far` along it."""
    mx, my = -ny, nx
    points = [(cx + mx * radius + nx * far, cy + my * radius + ny * far)]
    base = math.atan2(my, mx)
    for k in range(steps + 1):
        a = base + math.pi * k / steps
        points.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    points.append((cx - mx * radius + nx * far, cy - my * radius + ny * far))
    return points


def pocket_shape(geo, pocket):
    """Where a pocket's leather lies, in the scene's frame: the centre, the outward axis, the hole,
    and the angles round the centre it is drawn at, each with how far the leather reaches, whether
    it hangs down the frame's outside there, and how far the frame's edge is.

    A corner's leather covers the rounded corner, flush with the frame's edge, and a little past
    where the curve ends; a side pocket's stands out past the rail, a half round as wide as the
    notch below it, where its net shows. Where the leather reaches the edge it hangs down the
    outside (the skirt); elsewhere it ends on the rail."""
    W, L = geo["W"], geo["L"]
    cx, cy = pocket["center"][0] - W / 2, pocket["center"][1] - L / 2
    nx, ny = pocket["axis"]
    hole = pocket["radius"] + 0.002
    edge = outer_distance(geo, cx, cy, nx, ny)
    if pocket["corner"]:
        spread = edge + 0.014
    else:
        spread = math.hypot(hole + NET_BULGE + NOTCH_ROOM, edge) + 0.004

    def skirt(a):
        return outer_distance(geo, cx, cy, math.cos(a), math.sin(a)) <= spread

    base = [2 * math.pi * k / LEATHER_STEPS for k in range(LEATHER_STEPS)]
    angles = []
    for a in base:
        b = a + 2 * math.pi / LEATHER_STEPS
        angles.append((a, skirt(a)))
        if skirt(a) != skirt(b):
            # Both sides of where the skirt starts or stops, at one angle: its end is square.
            lo, hi = a, b
            for _ in range(50):
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if skirt(mid) == skirt(a) else (lo, mid)
            angles += [(lo, skirt(a)), (lo, skirt(b))]
    samples = []
    for a, hangs in angles:
        d = outer_distance(geo, cx, cy, math.cos(a), math.sin(a))
        reach = d if hangs and pocket["corner"] else spread
        samples.append((a, reach, hangs, d))
    return {"corner": pocket["corner"], "center": (cx, cy), "axis": (nx, ny), "hole": hole,
            "radius": pocket["radius"], "samples": samples}


def leather(name, geo, shape, rh):
    """A pocket's leather: a cover over the rail round the hole, rolled over the hole's edge and
    along its own outer edge, hanging down the frame's outside where it reaches it, and lining the
    hole down to the net. The part over the cushions and the bed is cut away; below the slate the
    lining runs on round the hole."""
    W, L, cw = geo["W"], geo["L"], geo["cushionWidth"]
    cx, cy = shape["center"]
    hole = shape["hole"]
    top = rh + LEATHER_LIFT

    def arc(cr, cz, radius, degrees):
        return [(cr + radius * math.cos(math.radians(f)), cz + radius * math.sin(math.radians(f))) for f in degrees]

    sections = []
    for a, reach, hangs, _ in shape["samples"]:
        ca, sa = math.cos(a), math.sin(a)
        points = [(hole, LINING), (hole, top - RIM), *arc(hole + RIM, top - RIM, RIM, (150, 120, 90)),
                  (reach - EDGE, top), *arc(reach - EDGE, top - EDGE, EDGE, (60, 30, 0))]
        if hangs:
            inner = min(reach - LEATHER, outer_distance(geo, cx, cy, ca, sa, APRON_INSET))
            points += [(reach, SKIRT), (inner, SKIRT), (inner, APRON_TOP)]
        else:
            points += [(reach, APRON_TOP - 0.002), (reach - 0.004, APRON_TOP - 0.002), (reach - 0.004, APRON_TOP)]
        points += [(hole + LEATHER, APRON_TOP), (hole + LEATHER, LINING)]
        sections.append([(cx + rho * ca, cy + rho * sa, z) for rho, z in points])
    obj = loft_ring(name, sections)
    sx = 1 if cx > 0 else -1
    x0, x1 = sorted((sx * (W / 2 + cw), 0.0))
    if shape["corner"]:
        sy = 1 if cy > 0 else -1
        y0, y1 = sorted((sy * (L / 2 + cw), 0.0))
    else:
        y0, y1 = cy - 0.5, cy + 0.5
    common.boolean(obj, slab(f"{name}-cut", x0, y0, x1, y1, -SLATE - 0.0005, top + 0.05))
    return obj


def leather_cutter(name, shape, rh):
    """What a pocket's leather takes out of the rail: its footprint, and past the frame's edge
    wherever it hangs down the outside."""
    cx, cy = shape["center"]
    polygon = []
    for a, reach, hangs, d in shape["samples"]:
        rho = d + 0.06 if hangs else reach
        polygon.append((cx + rho * math.cos(a), cy + rho * math.sin(a)))
    return prism(name, polygon, APRON_TOP - 0.01, rh + 0.01, (cx, cy))


def net(name, shape):
    """The net hanging from a pocket's lining, its floor where the pocketed balls rest, with
    texture coordinates round it and down it (metres) for the game to knot it."""
    cx, cy = shape["center"]
    hole, r = shape["hole"], shape["radius"]
    profile = [
        (hole, LINING + 0.004), (hole + 0.004, LINING - 0.020), (hole + NET_BULGE, LINING - 0.050),
        (hole + 0.003, NET_FLOOR + 0.028), (hole - 0.006, NET_FLOOR + 0.011), (0.80 * r, NET_FLOOR + 0.001),
        (0.50 * r, NET_FLOOR - 0.0035), (0.0, NET_FLOOR - 0.005),
    ]
    verts, uvs, faces = [], [], []
    down = 0.0
    for i, (rho, z) in enumerate(profile):
        if i:
            down += math.hypot(rho - profile[i - 1][0], z - profile[i - 1][1])
        for j in range(NET_STEPS + 1):
            a = 2 * math.pi * j / NET_STEPS
            verts.append((cx + rho * math.cos(a), cy + rho * math.sin(a), z))
            uvs.append((j / NET_STEPS, down))
    row = NET_STEPS + 1
    for i in range(len(profile) - 1):
        for j in range(NET_STEPS):
            faces.append((i * row + j, i * row + j + 1, (i + 1) * row + j + 1, (i + 1) * row + j))
    obj = mesh_object(name, verts, faces)
    layer = obj.data.uv_layers.new(name="UVMap")
    for loop in obj.data.loops:
        layer.data[loop.index].uv = uvs[loop.vertex_index]
    return obj
