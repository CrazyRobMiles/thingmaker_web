"""Record what each device in boxmaker.py (a FreeCAD macro) adds to and cuts
from the case it's placed on, without FreeCAD.

    python tools/boxmaker/extract.py PATH/TO/boxmaker.py [OUT.json]

boxmaker's device classes are run with stand-ins for FreeCAD's Part and Base
that record each shape made instead of making it. Every Device subclass is
made with no margins and placed at (0, 0) on a stand-in tray, twice - with
the tray 2mm and then 3mm thick - and what it fuses onto and cuts from the
tray is written out. A number that changes with the tray's thickness is
written as {"c": c, "t": k}, meaning c + k * thickness.

Only boxmaker's imports, classes and constants are run - not the box it makes
when it's loaded in FreeCAD. tools/boxmaker/draft.mjs turns a device's record
into a thingmaker device definition (see lib/library.js).
"""
import ast
import copy
import json
import math
import sys
import types


class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)

    def __add__(self, o):
        return Vector(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o):
        return Vector(self.x - o.x, self.y - o.y, self.z - o.z)

    def list(self):
        return [self.x, self.y, self.z]


class Shape:
    """A shape boxmaker made: {"kind": ..., ...}, and what it's been fused
    with and cut by since."""

    def __init__(self, kind, **fields):
        self.d = {"kind": kind, **fields}
        if self.d.get("kind") == "box":
            self.d.setdefault("angle", 0.0)

    def fuse(self, other):
        return Shape("fuse", parts=[self.d, other.d])

    def cut(self, other):
        return Shape("cut", parts=[self.d, other.d])

    def copy(self):
        return Shape(**copy.deepcopy(self.d))

    def translate(self, v):
        self.d = moved(self.d, v.list())
        return self

    def rotate(self, centre, axis, angle):
        """Turned `angle` degrees about `axis` through `centre` - only the z
        axis is understood (anything else is recorded as it was asked for)."""
        if isinstance(axis, Vector) and abs(axis.x) < 1e-9 and abs(axis.y) < 1e-9 and axis.z != 0:
            self.d = turned(self.d, centre.list(), angle if axis.z > 0 else -angle)
        else:
            self.d = {"kind": "rotated", "about": [centre.list(), axis.list(), angle], "shape": self.d}
        return self


def moved(d, by):
    """Shape `d` moved by vector `by`."""
    d = dict(d)
    if "at" in d:
        d["at"] = [a + b for a, b in zip(d["at"], by)]
    if "parts" in d:
        d["parts"] = [moved(p, by) for p in d["parts"]]
    if "shape" in d:
        d["shape"] = moved(d["shape"], by)
    return d


def turned(d, centre, angle):
    """Shape `d` turned `angle` degrees about the z axis through `centre`.
    A turned box keeps its size, its corner `at` moved and its "angle" (about
    that corner) grown."""
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    d = dict(d)
    if "at" in d:
        x, y = d["at"][0] - centre[0], d["at"][1] - centre[1]
        d["at"] = [centre[0] + x * c - y * s, centre[1] + x * s + y * c, d["at"][2]]
    if "dir" in d:
        x, y = d["dir"][0], d["dir"][1]
        d["dir"] = [x * c - y * s, x * s + y * c, d["dir"][2]]
    if d.get("kind") == "box":
        d["angle"] = (d.get("angle", 0.0) + angle) % 360.0
    if "parts" in d:
        d["parts"] = [turned(p, centre, angle) for p in d["parts"]]
    if "shape" in d:
        d["shape"] = turned(d["shape"], centre, angle)
    return d


class Tray(Shape):
    """The case part a device is placed on: records what's done to it."""

    def __init__(self):
        super().__init__("tray")
        self.ops = []

    def fuse(self, other):
        self.ops.append({"op": "fuse", "shape": other.d})
        return self

    def cut(self, other):
        self.ops.append({"op": "cut", "shape": other.d})
        return self


def _vec(v, default=None):
    return (v or default or Vector()).list()


def make_box(w, d, h, pos=None, direction=None):
    return Shape("box", size=[float(w), float(d), float(h)], at=_vec(pos))


def make_cylinder(r, h, pos=None, direction=None, angle=360):
    return Shape("cylinder", r=float(r), h=float(h), at=_vec(pos), dir=_vec(direction, Vector(0, 0, 1)))


def make_cone(r1, r2, h, pos=None, direction=None, angle=360):
    return Shape("cone", r1=float(r1), r2=float(r2), h=float(h), at=_vec(pos), dir=_vec(direction, Vector(0, 0, 1)))


def make_sphere(r, pos=None, *args):
    return Shape("sphere", r=float(r), at=_vec(pos))


def _anything(name):
    """A stand-in for anything else boxmaker might call (it's recorded)."""
    def made(*args, **kwargs):
        return Shape(name, args=[a.list() if isinstance(a, Vector) else repr(a) for a in args])
    return made


def stand_ins():
    part = types.ModuleType("Part")
    part.makeBox, part.makeCylinder, part.makeCone, part.makeSphere = make_box, make_cylinder, make_cone, make_sphere
    part.__getattr__ = lambda name: _anything(name)
    freecad = types.ModuleType("FreeCAD")
    freecad.Base = types.SimpleNamespace(Vector=Vector)
    for name, module in [("Part", part), ("FreeCAD", freecad), ("Mesh", types.ModuleType("Mesh"))]:
        sys.modules[name] = module


def load(path):
    """boxmaker's imports, classes and constants, as a namespace (not the
    box it makes when it's run)."""
    tree = ast.parse(open(path, encoding="utf-8").read(), path)
    keep = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.FunctionDef, ast.Assign))]
    namespace = {"__name__": "boxmaker", "print": lambda *a, **k: None}
    exec(compile(ast.Module(body=keep, type_ignores=[]), path, "exec"), namespace)
    return namespace


def used_in(path):
    """{class name: [the box functions that make one]} - where boxmaker cut
    a device's connector holes, by hand, after placing it."""
    out = {}
    for node in ast.parse(open(path, encoding="utf-8").read(), path).body:
        if isinstance(node, ast.FunctionDef):
            for call in ast.walk(node):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Name):
                    users = out.setdefault(call.func.id, [])
                    if node.name not in users:
                        users.append(node.name)
    return out


def numbers(a, b, thickness_a, thickness_b):
    """Two records of the same thing, made with trays of different
    thicknesses, as one: numbers that differ become {"c", "t"}."""
    if isinstance(a, dict):
        return {k: numbers(a[k], b[k], thickness_a, thickness_b) for k in a}
    if isinstance(a, list):
        return [numbers(x, y, thickness_a, thickness_b) for x, y in zip(a, b)]
    if isinstance(a, float) and a != b:
        k = (b - a) / (thickness_b - thickness_a)
        return {"c": round(a - k * thickness_a, 6), "t": round(k, 6)}
    return round(a, 6) if isinstance(a, float) else a


def record(cls, Device, thickness_a=2.0, thickness_b=3.0):
    runs = []
    for thickness in (thickness_a, thickness_b):
        try:
            device = cls("device", xMargin=0, yMargin=0)
        except TypeError:
            device = cls("device")
        tray = Tray()
        device.placeComponent(0.0, 0.0, tray, thickness)
        runs.append((device, tray.ops))
    device, ops = runs[0]
    if len(ops) != len(runs[1][1]):
        raise ValueError("it does different things on trays of different thicknesses")
    settings = {}
    for name in ("pillarType", "pillarRadius", "pillarHeight", "holeRadius", "holeCounterSinkDepth",
                 "holeCounterSinkRadius", "xMargin", "yMargin"):
        if hasattr(device, name):
            settings[name] = getattr(device, name)
    constants = {}
    for klass in reversed(cls.__mro__):
        for name, value in vars(klass).items():
            if not name.startswith("_") and isinstance(value, (int, float)) and not isinstance(value, bool):
                constants[name] = value
    return {
        "class": cls.__name__,
        "partType": device.partType,
        "bases": [k.__name__ for k in cls.__mro__[1:] if issubclass(k, Device)],
        "size": [device.width, device.height],
        "settings": settings,
        "constants": constants,
        "ops": numbers(ops, runs[1][1], thickness_a, thickness_b),
    }


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().split("\n\n")[1])
        return 2
    stand_ins()
    namespace = load(argv[1])
    Device = namespace["Device"]
    out = {"source": argv[1], "devices": {}, "failed": {}, "usedIn": used_in(argv[1])}
    for name, cls in namespace.items():
        if isinstance(cls, type) and issubclass(cls, Device) and cls is not Device and cls.__module__ == "boxmaker":
            if name == "PillarSupportedDevice":
                continue
            try:
                out["devices"][name] = record(cls, Device)
            except Exception as e:  # noqa: BLE001 - a device that can't be made is reported, not fatal
                out["failed"][name] = "%s: %s" % (type(e).__name__, e)
    text = json.dumps(out, indent=1)
    if len(argv) > 2:
        open(argv[2], "w", encoding="utf-8").write(text)
        print("%d devices recorded, %d couldn't be (see \"failed\") -> %s" % (len(out["devices"]), len(out["failed"]), argv[2]))
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
