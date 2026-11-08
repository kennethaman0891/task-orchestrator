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
import { InteriorWalkControls } from './InteriorWalkControls';
import type { Project } from '@/city/types';

const FLY_SPEED = 4.5;

export function CameraRig() {
  const controls = useRef<any>(null);
  const camera = useThree((s) => s.camera);
  const cameraTarget = useCityStore((s) => s.cameraTarget);
  const nav = useCityStore((s) => s.nav);
  const interiorViewMode = useCityStore((s) => s.interiorViewMode);
  const turntable = useCityStore((s) => s.turntable);
  const pending = useRef<{ pos: THREE.Vector3; look: THREE.Vector3; startTime: number } | null>(null);

  const radius = cityRadius();
  const isCarMode = nav.mode === 'car';
  const isInteriorMode = nav.mode === 'interior';
  const isWalkIn = isInteriorMode && interiorViewMode === 'walk-in';
  const minDistance = isCarMode ? 0.05 : isInteriorMode ? 0.5 : 4;
  const maxDistance = isCarMode ? 25 : isInteriorMode ? 18 : radius * 2.4;

  useEffect(() => {
    const c = controls.current;
    if (c) {
      c.minDistance = minDistance;
      c.maxDistance = maxDistance;
      c.update();
    }
  }, [minDistance, maxDistance]);

  // Cancel any automated flight immediately as soon as the user starts dragging or rotating
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const handleUserInteraction = () => {
      pending.current = null;
    };
    c.addEventListener('start', handleUserInteraction);
    return () => {
      c.removeEventListener('start', handleUserInteraction);
    };
  }, []);

  // Listen to step-rotation and step-zoom events from FloorNav HUD
  useEffect(() => {
    const handleStepRotate = (e: Event) => {
      const custom = e as CustomEvent<{ deltaRad: number }>;
      const delta = custom.detail?.deltaRad ?? 0;
      const c = controls.current;
      if (!c || isWalkIn) return;
      pending.current = null;
      const target = c.target as THREE.Vector3;
      const offset = new THREE.Vector3().subVectors(camera.position, target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta);
      camera.position.copy(target).add(offset);
      c.update();
    };

    const handleStepZoom = (e: Event) => {
      const custom = e as CustomEvent<{ factor: number }>;
      const factor = custom.detail?.factor ?? 1;
      const c = controls.current;
      if (!c || isWalkIn) return;
      pending.current = null;
      const target = c.target as THREE.Vector3;
      const offset = new THREE.Vector3().subVectors(camera.position, target);
      const nextDist = offset.length() * factor;
      if (nextDist >= minDistance && nextDist <= maxDistance) {
        offset.multiplyScalar(factor);
        camera.position.copy(target).add(offset);
        c.update();
      }
    };

    window.addEventListener('tto-camera-rotate', handleStepRotate);
    window.addEventListener('tto-camera-zoom', handleStepZoom);
    return () => {
      window.removeEventListener('tto-camera-rotate', handleStepRotate);
      window.removeEventListener('tto-camera-zoom', handleStepZoom);
    };
  }, [camera, isWalkIn, minDistance, maxDistance]);

  useEffect(() => {
    if (!cameraTarget) return;
    pending.current = {
      pos: new THREE.Vector3(cameraTarget.x, cameraTarget.y, cameraTarget.z),
      look: new THREE.Vector3(cameraTarget.lookX, cameraTarget.lookY, cameraTarget.lookZ),
      startTime: performance.now(),
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
    const elapsed = performance.now() - p.startTime;
    // Timeout guard (max 1.2s flight) + distance threshold
    if (elapsed > 1200 || (camera.position.distanceTo(p.pos) < 0.05 && c.target.distanceTo(p.look) < 0.05)) {
      pending.current = null;
    }
  });

  // One-time camera placement (overview orbit around the city centre).
  useEffect(() => {
    camera.position.set(radius * 0.85, radius * 0.6, radius * 0.85);
    const c = controls.current;
    if (c) c.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enabled={!isWalkIn}
        enableDamping
        dampingFactor={0.08}
        minDistance={minDistance}
        maxDistance={maxDistance}
        maxPolarAngle={Math.PI / 2.05}
        autoRotate={turntable && !isWalkIn}
        autoRotateSpeed={2.2}
        target={[0, 4, 0]}
      />
      {isWalkIn && <InteriorWalkControls />}
    </>
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
export function interiorTarget(
  plot: { x: number; y: number },
  floorIndex: number,
  floorH: number,
  buildingDepth: number,
  viewPreset: 'overview' | 'walkin' | 'desks' | 'servers' | 'blueprint' | 'lounge' | 'topdown' = 'overview',
) {
  const c = plotWorldPosition(plot);
  const fy = floorIndex * floorH + 0.3;

  if (viewPreset === 'topdown') {
    return {
      x: c[0],
      y: fy + 8.6,
      z: c[2] + 0.01,
      lookX: c[0],
      lookY: fy + 0.2,
      lookZ: c[2],
    };
  }
  if (viewPreset === 'walkin') {
    // Stepped right inside the floor at eye level!
    return {
      x: c[0],
      y: fy + 1.45,
      z: c[2] + buildingDepth * 0.25,
      lookX: c[0],
      lookY: fy + 1.35,
      lookZ: c[2] - buildingDepth * 0.3,
    };
  }
  if (viewPreset === 'desks') {
    return {
      x: c[0] - 1.9,
      y: fy + 1.35,
      z: c[2] + 1.6,
      lookX: c[0] - 1.9,
      lookY: fy + 0.85,
      lookZ: c[2] + 0.2,
    };
  }
  if (viewPreset === 'servers') {
    return {
      x: c[0] + 1.8,
      y: fy + 1.4,
      z: c[2] - 0.4,
      lookX: c[0] + 2.4,
      lookY: fy + 1.1,
      lookZ: c[2] - 1.6,
    };
  }
  if (viewPreset === 'blueprint') {
    return {
      x: c[0],
      y: fy + 1.4,
      z: c[2] - 0.9,
      lookX: c[0],
      lookY: fy + 1.35,
      lookZ: c[2] - 2.4,
    };
  }
  if (viewPreset === 'lounge') {
    return {
      x: c[0] + 1.6,
      y: fy + 1.25,
      z: c[2] + 1.8,
      lookX: c[0] + 2.2,
      lookY: fy + 0.8,
      lookZ: c[2] + 0.6,
    };
  }

  // Default 'overview' dollhouse view: elevated 35-40 degrees, clean perspective right into the floor!
  return {
    x: c[0] + 2.2,
    y: fy + 4.4,
    z: c[2] + buildingDepth * 0.5 + 4.8,
    lookX: c[0],
    lookY: fy + 0.8,
    lookZ: c[2] - 0.2,
  };
}

/** Fly INTO a car's cabin (car mode). Supports cockpit, driver POV, or chase view. */
export function carCabinTarget(
  projectPlot: { x: number; y: number },
  carTransform: [number, number, number, number],
  preset: 'cockpit' | 'driver' | 'chase' = 'cockpit',
): { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } {
  const world = plotWorldPosition(projectPlot);
  const [dx, dy, dz, rotY] = carTransform;
  const carX = world[0] + dx;
  const carY = dy;
  const carZ = world[2] + dz;

  const sin = Math.sin(rotY);
  const cos = Math.cos(rotY);

  let localCamX = 0.22;
  let localCamY = 0.78;
  let localCamZ = -0.22;
  let localLookX = -0.08;
  let localLookY = 0.62;
  let localLookZ = 0.68;

  if (preset === 'driver') {
    localCamX = -0.28;
    localCamY = 0.82;
    localCamZ = -0.16;
    localLookX = -0.28;
    localLookY = 0.68;
    localLookZ = 0.82;
  } else if (preset === 'chase') {
    localCamX = 0;
    localCamY = 1.45;
    localCamZ = -2.40;
    localLookX = 0;
    localLookY = 0.60;
    localLookZ = 0.40;
  }

  return {
    x: carX + (localCamX * cos + localCamZ * sin),
    y: carY + localCamY,
    z: carZ + (-localCamX * sin + localCamZ * cos),
    lookX: carX + (localLookX * cos + localLookZ * sin),
    lookY: carY + localLookY,
    lookZ: carZ + (-localLookX * sin + localLookZ * cos),
  };
}
