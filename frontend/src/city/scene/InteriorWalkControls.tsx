// Developer City — InteriorWalkControls: Real 3D first-person walk-through controls inside the building room.
// Lets the user step INSIDE the floor at eye level, walk around using WASD or arrow keys,
// look around 360° with mouse drag, and click to walk to any spot on the floor.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useCityStore } from '@/city/store';
import { plotWorldPosition } from './CityGrid';
import { fittedArchetype } from './plotFit';

const WALK_SPEED = 3.6; // units per second
const MOUSE_SENSITIVITY = 0.0035;

export function InteriorWalkControls() {
  const { camera, gl } = useThree();
  const nav = useCityStore((s) => s.nav);
  const projects = useCityStore((s) => s.projects);
  const viewMode = useCityStore((s) => s.interiorViewMode);

  const keys = useRef<{ forward: boolean; backward: boolean; left: boolean; right: boolean }>({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  const isDragging = useRef(false);
  const prevMouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const yaw = useRef<number>(Math.PI);
  const pitch = useRef<number>(0);
  const initializedForFloor = useRef<string | null>(null);

  const isInterior = nav.mode === 'interior';
  const isWalkIn = isInterior && viewMode === 'walk-in';

  // Keyboard navigation listeners (WASD / Arrows)
  useEffect(() => {
    if (!isWalkIn) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture when user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.forward = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.backward = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.right = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.forward = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.backward = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.right = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isWalkIn]);

  // Pointer drag listeners for looking around 360° inside the room
  useEffect(() => {
    if (!isWalkIn) return;
    const dom = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // Left mouse button
      isDragging.current = true;
      prevMouse.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - prevMouse.current.x;
      const dy = e.clientY - prevMouse.current.y;
      prevMouse.current = { x: e.clientX, y: e.clientY };

      // Direct scalar accumulation avoids quaternion-to-euler gimbal locking
      yaw.current -= dx * MOUSE_SENSITIVITY;
      pitch.current -= dy * MOUSE_SENSITIVITY;

      // Clamp vertical look (pitch) so camera does not flip upside down
      const maxPitch = Math.PI * 0.38;
      pitch.current = Math.max(-maxPitch, Math.min(maxPitch, pitch.current));

      euler.current.set(pitch.current, yaw.current, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler.current);
    };

    const onPointerUp = () => {
      isDragging.current = false;
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isWalkIn, gl.domElement, camera]);

  // When switching to Walk-In mode, position camera inside the room at eye level
  useEffect(() => {
    if (!isWalkIn) {
      initializedForFloor.current = null;
      return;
    }

    const p = projects[nav.projectId];
    if (!p) return;
    const floorKey = `${p.id}_${nav.floorIndex}`;
    if (initializedForFloor.current === floorKey) return;
    initializedForFloor.current = floorKey;

    const fitted = fittedArchetype(p.building.buildingStyle || p.type, p.type, p.building.scale);
    const center = plotWorldPosition(p.plot);
    const fy = nav.floorIndex * fitted.floorH;
    const eyeH = 1.45; // Human standing eye level in meters/units

    // Place camera slightly forward in the room looking toward the workstations and server racks
    camera.position.set(center[0], fy + eyeH, center[2] + fitted.depth * 0.28);
    yaw.current = Math.PI;
    pitch.current = 0;
    euler.current.set(0, Math.PI, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler.current);
  }, [isWalkIn, nav, projects, camera]);

  // Frame update: handle walking movement smoothly
  useFrame((_, delta) => {
    if (!isWalkIn) return;
    const p = projects[nav.projectId];
    if (!p) return;

    const fitted = fittedArchetype(p.building.buildingStyle || p.type, p.type, p.building.scale);
    const center = plotWorldPosition(p.plot);
    const fy = nav.floorIndex * fitted.floorH;
    const eyeH = 1.45;

    // Movement direction in local space
    const moveZ = (keys.current.backward ? 1 : 0) - (keys.current.forward ? 1 : 0);
    const moveX = (keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0);

    if (moveX !== 0 || moveZ !== 0) {
      const step = WALK_SPEED * delta;
      const moveVec = new THREE.Vector3(moveX, 0, moveZ).normalize().multiplyScalar(step);

      // Apply yaw rotation to move vector (move relative to where user is looking horizontally)
      moveVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current);

      camera.position.x += moveVec.x;
      camera.position.z += moveVec.z;
    }

    // Keep eye level strictly stable
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, fy + eyeH, 0.2);

    // Collision boundary: clamp inside room walls
    const halfW = fitted.width * 0.5 - 0.45;
    const halfD = fitted.depth * 0.5 - 0.45;

    camera.position.x = Math.max(center[0] - halfW, Math.min(center[0] + halfW, camera.position.x));
    camera.position.z = Math.max(center[2] - halfD, Math.min(center[2] + halfD, camera.position.z));
  });

  return null;
}
