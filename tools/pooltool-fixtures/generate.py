# Copyright (C) 2026 Stanislav Georgiev
# https://github.com/slaviboy
#
# This file is part of Pool.
#
# Pool is free software: you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version. See the LICENSE file for the full terms.

"""Runs the comparison scenarios through the real pooltool, for the tests of the TypeScript port.

Reads tests/fixtures/pooltool/scenarios.json (the shots) and blender/table-geometry-<size>.json
(the table the simulation uses, cushion for cushion), simulates each shot with pooltool 0.6.0's
default physics, and writes every event and every ball's final state to
tests/fixtures/pooltool/results.json. See README.md for how to set up the environment.

The resolver is built explicitly with default_resolver(): Resolver.default() would read a user's
~/.config/pooltool/physics/resolver.yaml instead.
"""

import json
import os
import sys

import numpy as np

import pooltool as pt
from pooltool.objects import (
    Ball,
    BallParams,
    BallState,
    CircularCushionSegment,
    Cue,
    CueSpecs,
    CushionDirection,
    CushionSegments,
    LinearCushionSegment,
    Pocket,
    Table,
    TableType,
)
from pooltool.physics.engine import PhysicsEngine
from pooltool.physics.resolve.resolver import default_resolver

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
R = 0.028575
PARAMS = BallParams(
    m=0.170097,
    R=R,
    u_s=0.2,
    u_r=0.01,
    u_sp_proportionality=10 * 2 / 5 / 9,
    u_b=0.05,
    e_b=0.95,
    e_c=0.85,
    f_c=0.2,
    g=9.81,
)


def table_for(size):
    with open(os.path.join(ROOT, "blender", f"table-geometry-{size}.json")) as f:
        physics = json.load(f)["physics"]
    h = physics["height"]
    linear = {
        f"L{s['id']}": LinearCushionSegment(
            f"L{s['id']}",
            p1=np.array([*s["p1"], h], dtype=np.float64),
            p2=np.array([*s["p2"], h], dtype=np.float64),
            direction=CushionDirection.BOTH,
        )
        for s in physics["linear"]
    }
    circular = {
        f"C{c['id']}": CircularCushionSegment(
            f"C{c['id']}", center=np.array([*c["center"], h], dtype=np.float64), radius=c["radius"]
        )
        for c in physics["circular"]
    }
    pockets = {
        f"P{p['id']}": Pocket(
            f"P{p['id']}", center=np.array([*p["center"], 0.0], dtype=np.float64), radius=p["radius"]
        )
        for p in physics["pockets"]
    }
    return Table(
        cushion_segments=CushionSegments(linear=linear, circular=circular),
        pockets=pockets,
        table_type=TableType.POCKET,
    )


def system_for(scenario):
    balls = {}
    for i, b in enumerate(scenario["balls"]):
        v = b.get("v", [0, 0])
        w = b.get("w", [0, 0, 0])
        rvw = np.array([[b["x"], b["y"], R], [v[0], v[1], 0.0], w], dtype=np.float64)
        balls[str(i)] = Ball(str(i), state=BallState(rvw, b.get("s", 0), 0.0), params=PARAMS)
    c = scenario["cue"] or {"ball": 0, "V0": 0.0, "phi": 0.0, "theta": 0.0, "a": 0.0, "b": 0.0}
    cue = Cue(
        id="cue",
        V0=c["V0"],
        phi=c["phi"],
        theta=c["theta"],
        a=c["a"],
        b=c["b"],
        cue_ball_id=str(c["ball"]),
        specs=CueSpecs(M=0.539, end_mass=0.170097 / 30),
    )
    return pt.System(cue=cue, table=table_for(scenario["size"]), balls=balls)


def main():
    with open(os.path.join(ROOT, "tests", "fixtures", "pooltool", "scenarios.json")) as f:
        scenarios = json.load(f)
    engine = PhysicsEngine(resolver=default_resolver())
    results = {}
    for name, scenario in scenarios.items():
        shot = pt.simulate(system_for(scenario), engine=engine, max_events=20000)
        events = [
            {"type": e.event_type.value, "t": e.time, "ids": list(e.ids)}
            for e in shot.events
            if e.event_type.value != "none"
        ]
        final = {
            ball_id: {"r": ball.state.rvw[0].tolist(), "s": int(ball.state.s)}
            for ball_id, ball in shot.balls.items()
        }
        results[name] = {"events": events, "final": final, "pooltool": pt.__version__}
        print(f"{name}: {len(events)} events", file=sys.stderr)
    out = os.path.join(ROOT, "tests", "fixtures", "pooltool", "results.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
