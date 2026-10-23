#!/usr/bin/env python3
"""Fixed Developer City mesh specs.

POST /api/city/car-spec accepts {"kind": "car" | "street", "sentence": string}.
The sentence is not used to generate anything. This route does not call an
LLM and does not run caller Python. It returns the same sample object that
scripts/city_car_spec.py or scripts/city_street_spec.py prints.

Mounted from backend/main.py the same way as the projects router.
"""

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/city", tags=["city"])

# Inlined copies of the script samples. Do not shell out to those scripts.
CAR_SPEC = {
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

STREET_SPEC = {
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


class CitySpecIn(BaseModel):
    kind: str
    sentence: str


def _sample(spec: dict) -> dict:
    return json.loads(json.dumps(spec))


@router.post("/car-spec")
def city_car_spec(body: CitySpecIn) -> dict:
    """Return the fixed sample for kind. sentence is accepted and ignored."""
    if body.kind == "car":
        return _sample(CAR_SPEC)
    if body.kind == "street":
        return _sample(STREET_SPEC)
    raise HTTPException(400, "kind must be 'car' or 'street'")
