# pooltool reference runs

`generate.py` simulates the shots in `tests/fixtures/pooltool/scenarios.json` with the real
pooltool 0.6.0, on the exact table the game uses (read from `blender/table-geometry-*.json`), and
writes `tests/fixtures/pooltool/results.json`. The unit test `tests/unit/physics/pooltool.test.ts`
compares the TypeScript translation against those results. Python is needed only to regenerate
them; the tests themselves run without it.

## Setup (Windows, project-local, no administrator rights)

Everything lands in gitignored folders under `tools/`.

```sh
# uv, the standalone binary
mkdir -p tools/.uv/bin
curl -sSfL -o tools/.uv/uv.zip https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip
unzip -o tools/.uv/uv.zip -d tools/.uv/bin && rm tools/.uv/uv.zip

# Python 3.13 and a virtual environment, kept inside tools/
export UV_PYTHON_INSTALL_DIR="$PWD/tools/.uv/python" UV_CACHE_DIR="$PWD/tools/.uv/cache"
tools/.uv/bin/uv.exe venv --python 3.13 tools/pooltool-fixtures/.venv
PY=tools/pooltool-fixtures/.venv/Scripts/python.exe

# pooltool without its declared dependencies, then those from PyPI. pooltool pins a panda3d
# development build from archive.panda3d.org on Windows, used only by its 3D viewer; the stable
# panda3d 1.10 (what pooltool uses on macOS) serves the physics just as well, and the archive was
# unreachable when this was set up.
tools/.uv/bin/uv.exe pip install --python $PY --no-deps "pooltool-billiards==0.6.0"
tools/.uv/bin/uv.exe pip install --python $PY "panda3d>=1.10.13,<1.11" "panda3d-gltf>=1.2.0" \
  "panda3d-simplepbr>=0.12.0" "numpy>=1.26.0" "numba>=0.59.0,<0.63" "llvmlite>=0.44.0,<0.46" \
  "scipy>=1.12.0" "attrs>=21.3.0" "cattrs>=22.1.0" "msgpack>=1.0.0" "msgpack-numpy>=0.4.8" \
  "pyyaml>=5.2" "click>=8.0.0" "Pillow>=6.2.0" "h5py>=3.10" "h11>=0.16.0" "rich>=14.0.0,<15.0.0" \
  numpy-quaternion
```

## Run

```sh
tools/pooltool-fixtures/.venv/Scripts/python.exe -I tools/pooltool-fixtures/generate.py
```

pooltool is Apache-2.0 software by Evan Kiefl and contributors (https://github.com/ekiefl/pooltool).
