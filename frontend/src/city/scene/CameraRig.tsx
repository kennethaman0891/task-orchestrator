// Developer City — CameraRig: orbit/zoom/pan + fly-to transitions.
// Mount: overview orbit around city centre. When the store's cameraTarget
// changes (nonce), the rig smoothly flies camera + target there. Orbit
// presets (180°/360° exploration) are pre-computed targets.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCityStore } from '@/city/store';
import { plotWorldPosition, cityRadius } from './CityGrid';
import type { Project } from '@/city/types';

const FLY_SPEED = 4.5;

export function CameraRig() {
  const controls = useRef<any>(null);
  const camera = useThree((s) => s.camera);
  const cameraTarget = useCityStore((s) => s.cameraTarget);
  const pending = useRef<{ pos: THREE.Vector3; look: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!cameraTarget) return;
    pending.current = {
      pos: new THREE.Vector3(cameraTarget.x, cameraTarget.y, cameraTarget.z),
      look: new THREE.Vector3(cameraTarget.lookX, cameraTarget.lookY, cameraTarget.lookZ),
    };
  }, [cameraTarget]);

  useFrame((_, delta) => {
    const p = pending.current;
    if (!p) return;
    const c = controls.current;
    const t = Math.min(1, delta * FLY_SPEED);
    camera.position.lerp(p.pos, t);
    if (c) {
      c.target.lerp(p.look, t);
      c.update();
    }
    if (camera.position.distanceTo(p.pos) < 0.05 && c.target.distanceTo(p.look) < 0.05) {
      pending.current = null;
    }
  });

  const radius = cityRadius();

  // One-time camera placement (overview orbit around the city centre).
  useEffect(() => {
    camera.position.set(radius * 0.85, radius * 0.6, radius * 0.85);
    const c = controls.current;
    if (c) c.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={5}
      maxDistance={radius * 2.4}
      maxPolarAngle={Math.PI / 2.05}
      target={[0, 4, 0]}
    />
  );
}

/** Pre-computed orbit targets: 0°/90°/180°/360° sweeps around a focus. */
export function computeOrbitTarget(
  focus: Project | null,
  angleDeg: number,
  height = 34,
): { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } {
  const center = focus ? plotWorldPosition(focus.plot) : [0, 0, 0];
  const a = (angleDeg * Math.PI) / 180;
  const dist = focus ? 34 : cityRadius() * 1.1;
  return {
    x: center[0] + Math.sin(a) * dist,
    y: height,
    z: center[2] + Math.cos(a) * dist,
    lookX: center[0], lookY: 4, lookZ: center[2],
  };
}

export function cityOverviewTarget() {
  const d = cityRadius() * 1.3;
  return { x: d * 0.75, y: d * 0.62, z: d * 0.75, lookX: 0, lookY: 0, lookZ: 0 };
}

export function streetViewTarget(focus: Project | null = null) {
  const center = focus ? plotWorldPosition(focus.plot) : [0, 0, 0];
  return {
    x: center[0] + 6.5,
    y: 2.2,
    z: center[2] + 8.5,
    lookX: center[0],
    lookY: 9.5,
    lookZ: center[2],
  };
}

export function droneTarget(focus: Project | null = null) {
  const center = focus ? plotWorldPosition(focus.plot) : [0, 0, 0];
  return {
    x: center[0] + 24,
    y: 20,
    z: center[2] + 24,
    lookX: center[0],
    lookY: 5,
    lookZ: center[2],
  };
}

export function isometricTarget() {
  const d = cityRadius() * 0.95;
  return {
    x: d,
    y: d * 0.82,
    z: d,
    lookX: 0,
    lookY: 0,
    lookZ: 0,
  };
}

export function buildingFocusTarget(plot: { x: number; y: number }) {
  const c = plotWorldPosition(plot);
  return { x: c[0] + 15, y: 11, z: c[2] + 19, lookX: c[0], lookY: 4, lookZ: c[2] };
}

/** Fly INTO a floor of the building (interior mode). */
export function interiorTarget(plot: { x: number; y: number }, floorIndex: number, floorH: number, buildingDepth: number) {
  const c = plotWorldPosition(plot);
  const fy = floorIndex * floorH + 1.4;
  return {
    x: c[0],
    y: fy + 3.2,
    z: c[2] + buildingDepth * 0.5 + 7,
    lookX: c[0], lookY: fy, lookZ: c[2],
  };
}
