#!/usr/bin/env python3
"""Built-in Developer City street lamp. Prints JSON and exits. No input, no network."""

import json

# Cylinder size is [radius_top, radius_bottom, height], matching three.js.
# Every size component is in 0.02..3 and every position component is in -3..3.
SPEC = {
    "kind": "street",
    "parts": [
        {
            "shape": "cylinder",
            "size": [0.08, 0.08, 2.4],
            "position": [0.0, 1.2, 0.0],
            "color": "#475569",
        },
        {
            "shape": "box",
            "size": [0.42, 0.18, 0.28],
            "position": [0.0, 2.49, 0.0],
            "color": "#facc15",
        },
    ],
}


def main() -> None:
    print(json.dumps(SPEC))


if __name__ == "__main__":
    main()
