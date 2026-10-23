#!/usr/bin/env python3
"""Built-in Developer City sedan. Prints JSON and exits. No input, no network."""

import json

# Cylinder size is [radius_top, radius_bottom, height], matching three.js.
# Every size component is in 0.02..3 and every position component is in -3..3.
SPEC = {
    "kind": "car",
    "parts": [
        {
            "shape": "box",
            "size": [1.08, 0.28, 2.4],
            "position": [0.0, 0.36, 0.0],
            "color": "#1e40af",
        },
        {
            "shape": "box",
            "size": [0.92, 0.25, 1.25],
            "position": [0.0, 0.6, -0.15],
            "color": "#1e40af",
        },
        {
            "shape": "box",
            "size": [0.9, 0.22, 0.08],
            "position": [0.0, 0.59, 0.52],
            "color": "#93c5fd",
        },
        {
            "shape": "box",
            "size": [0.9, 0.22, 0.08],
            "position": [0.0, 0.59, -0.8],
            "color": "#93c5fd",
        },
        {
            "shape": "cylinder",
            "size": [0.2, 0.2, 0.14],
            "position": [-0.56, 0.2, 0.7],
            "color": "#111827",
        },
        {
            "shape": "cylinder",
            "size": [0.2, 0.2, 0.14],
            "position": [0.56, 0.2, 0.7],
            "color": "#111827",
        },
        {
            "shape": "cylinder",
            "size": [0.2, 0.2, 0.14],
            "position": [-0.56, 0.2, -0.7],
            "color": "#111827",
        },
        {
            "shape": "cylinder",
            "size": [0.2, 0.2, 0.14],
            "position": [0.56, 0.2, -0.7],
            "color": "#111827",
        },
    ],
}


def main() -> None:
    print(json.dumps(SPEC))


if __name__ == "__main__":
    main()
