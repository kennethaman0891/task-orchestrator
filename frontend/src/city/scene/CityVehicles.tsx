// Developer City — CityVehicles: animated traffic simulation.
// Taxis, cyber sedans, delivery vans, EV shuttles, and aerial drones cruising
// along the avenues with spinning wheels, glowing headlights, and taillights.

import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GRID_SPACING } from './CityGrid';
import { getAvenueCoordinates, ROAD_WIDTH, HALF_GRID } from './CityRoads';
import { useCityStore } from '@/city/store';

export interface VehicleState {
  id: string;
  type: 'taxi' | 'sedan' | 'van' | 'ev';
  color: string;
  axis: 'x' | 'z';
  roadCoord: number; // The fixed avenue coordinate (Z for X-axis road, X for Z-axis road)
  laneOffset: number; // +0.9 or -0.9 for right-hand driving
  dir: 1 | -1;
  pos: number; // Current progress along the road axis
  speed: number;
}

export function CityVehicles() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';
  const avenueCoords = useMemo(() => getAvenueCoordinates(), []);
  const roadLimit = HALF_GRID + GRID_SPACING * 1.1;

  // Initialize fleet of vehicles
  const vehicles = useMemo(() => {
    const list: VehicleState[] = [];
    const colors = ['#06b6d4', '#e11d48', '#f8fafc', '#3b82f6', '#8b5cf6', '#10b981', '#f97316'];

    avenueCoords.forEach((coord, i) => {
      // East-West avenue vehicles
      const ewDir = i % 2 === 0 ? 1 : -1;
      const ewLane = ewDir === 1 ? ROAD_WIDTH * 0.25 : -ROAD_WIDTH * 0.25;
      const typeEW: VehicleState['type'] = i % 3 === 0 ? 'taxi' : i % 3 === 1 ? 'sedan' : 'van';

      list.push({
        id: `veh-ew-${i}-1`,
        type: typeEW,
        color: typeEW === 'taxi' ? '#fbbf24' : colors[i % colors.length],
        axis: 'x',
        roadCoord: coord,
        laneOffset: ewLane,
        dir: ewDir as 1 | -1,
        pos: ((i * 19) % (roadLimit * 2)) - roadLimit,
        speed: 7.5 + (i % 4) * 1.5,
      });

      // Second vehicle on opposite lane
      const oppDir = (-ewDir) as 1 | -1;
      const oppLane = oppDir === 1 ? ROAD_WIDTH * 0.25 : -ROAD_WIDTH * 0.25;
      const typeOpp: VehicleState['type'] = i % 4 === 0 ? 'taxi' : 'ev';

      list.push({
        id: `veh-ew-${i}-2`,
        type: typeOpp,
        color: typeOpp === 'taxi' ? '#fbbf24' : colors[(i + 3) % colors.length],
        axis: 'x',
        roadCoord: coord,
        laneOffset: oppLane,
        dir: oppDir,
        pos: (((i * 23) + 30) % (roadLimit * 2)) - roadLimit,
        speed: 6.8 + (i % 3) * 1.8,
      });

      // North-South avenue vehicles
      if (i < avenueCoords.length - 1) {
        const nsDir = i % 2 === 0 ? 1 : -1;
        const nsLane = nsDir === 1 ? ROAD_WIDTH * 0.25 : -ROAD_WIDTH * 0.25;
        const typeNS: VehicleState['type'] = i % 2 === 0 ? 'sedan' : 'van';

        list.push({
          id: `veh-ns-${i}`,
          type: typeNS,
          color: colors[(i * 2) % colors.length],
          axis: 'z',
          roadCoord: coord,
          laneOffset: nsLane,
          dir: nsDir as 1 | -1,
          pos: ((i * 29) % (roadLimit * 2)) - roadLimit,
          speed: 7.0 + (i % 3) * 1.6,
        });
      }
    });

    return list;
  }, [avenueCoords, roadLimit]);

  // Vehicle mesh references for frame updates
  const vehicleRefs = useRef<(THREE.Group | null)[]>([]);
  const wheelRefs = useRef<(THREE.Mesh | null)[][]>([]);

  // Aerial drones
  const droneRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    // Update ground vehicles
    vehicles.forEach((veh, idx) => {
      veh.pos += veh.dir * veh.speed * dt;

      // Wrap-around seamlessly when exiting city perimeter
      if (veh.dir === 1 && veh.pos > roadLimit) {
        veh.pos = -roadLimit;
      } else if (veh.dir === -1 && veh.pos < -roadLimit) {
        veh.pos = roadLimit;
      }

      const group = vehicleRefs.current[idx];
      if (group) {
        if (veh.axis === 'x') {
          group.position.set(veh.pos, 0.08, veh.roadCoord + veh.laneOffset);
          group.rotation.y = veh.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          group.position.set(veh.roadCoord + veh.laneOffset, 0.08, veh.pos);
          group.rotation.y = veh.dir === 1 ? 0 : Math.PI;
        }
      }

      // Spin wheels
      const wheels = wheelRefs.current[idx];
      if (wheels) {
        wheels.forEach((w) => {
          if (w) w.rotation.x += veh.dir * veh.speed * dt * 3.5;
        });
      }
    });

    // Update aerial drones
    droneRefs.current.forEach((drone, di) => {
      if (!drone) return;
      const angle = (Date.now() * 0.0004 * (1 + di * 0.3) + di * 2) % (Math.PI * 2);
      const droneRadius = HALF_GRID * 0.75 + di * 8;
      const dx = Math.sin(angle) * droneRadius;
      const dz = Math.cos(angle) * droneRadius;
      const dy = 20 + Math.sin(angle * 2) * 2.5 + di * 3;
      drone.position.set(dx, dy, dz);
      drone.rotation.y = angle + Math.PI / 2;
    });
  });

  // Common Vehicle Materials
  const materials = useMemo(() => {
    return {
      window: new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.1,
        metalness: 0.9,
      }),
      wheel: new THREE.MeshStandardMaterial({
        color: '#1e293b',
        roughness: 0.9,
      }),
      rim: new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        metalness: 0.8,
        roughness: 0.2,
      }),
      headlight: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: '#ffffff',
        emissiveIntensity: isNight ? 2.5 : 1.0,
      }),
      taillight: new THREE.MeshStandardMaterial({
        color: '#ef4444',
        emissive: '#ef4444',
        emissiveIntensity: isNight ? 2.8 : 1.2,
      }),
      taxiSign: new THREE.MeshStandardMaterial({
        color: '#fef08a',
        emissive: '#fef08a',
        emissiveIntensity: isNight ? 2.2 : 0.8,
      }),
      droneBody: new THREE.MeshStandardMaterial({
        color: '#334155',
        metalness: 0.8,
        roughness: 0.3,
      }),
      droneBeacon: new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#38bdf8',
        emissiveIntensity: 3.0,
      }),
    };
  }, [isNight]);

  return (
    <group>
      {/* ── Ground Vehicles ───────────────────────────────────────── */}
      {vehicles.map((veh, idx) => {
        const bodyMat = new THREE.MeshStandardMaterial({
          color: veh.color,
          metalness: 0.4,
          roughness: 0.4,
        });

        if (!wheelRefs.current[idx]) wheelRefs.current[idx] = [];

        return (
          <group
            key={veh.id}
            ref={(el) => {
              vehicleRefs.current[idx] = el;
            }}
          >
            {/* ── Vehicle Model: Taxi / Sedan / Van / EV ──────────── */}
            {veh.type === 'taxi' ? (
              <group position={[0, 0.22, 0]}>
                {/* Main Body Chassis */}
                <mesh position={[0, 0.15, 0]} material={bodyMat} castShadow>
                  <boxGeometry args={[1.1, 0.3, 2.3]} />
                </mesh>
                {/* Cabin Roof */}
                <mesh position={[0, 0.4, -0.1]} material={bodyMat} castShadow>
                  <boxGeometry args={[0.95, 0.28, 1.3]} />
                </mesh>
                {/* Windshield & Windows */}
                <mesh position={[0, 0.4, 0.58]} rotation={[-0.3, 0, 0]} material={materials.window}>
                  <boxGeometry args={[0.92, 0.24, 0.08]} />
                </mesh>
                <mesh position={[0, 0.4, -0.78]} rotation={[0.2, 0, 0]} material={materials.window}>
                  <boxGeometry args={[0.92, 0.24, 0.08]} />
                </mesh>
                {/* Taxi Rooftop Light */}
                <mesh position={[0, 0.6, -0.1]} material={materials.taxiSign}>
                  <boxGeometry args={[0.38, 0.12, 0.22]} />
                </mesh>
              </group>
            ) : veh.type === 'van' ? (
              <group position={[0, 0.28, 0]}>
                {/* Van Body */}
                <mesh position={[0, 0.35, 0]} material={bodyMat} castShadow>
                  <boxGeometry args={[1.2, 0.65, 2.6]} />
                </mesh>
                {/* Van Windshield */}
                <mesh position={[0, 0.45, 1.25]} rotation={[-0.2, 0, 0]} material={materials.window}>
                  <boxGeometry args={[1.1, 0.38, 0.08]} />
                </mesh>
              </group>
            ) : veh.type === 'ev' ? (
              <group position={[0, 0.24, 0]}>
                {/* Aerodynamic EV Capsule */}
                <mesh position={[0, 0.25, 0]} material={bodyMat} castShadow>
                  <boxGeometry args={[1.05, 0.4, 2.0]} />
                </mesh>
                <mesh position={[0, 0.45, 0]} material={materials.window}>
                  <sphereGeometry args={[0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                </mesh>
              </group>
            ) : (
              <group position={[0, 0.22, 0]}>
                {/* Sleek Sedan Body */}
                <mesh position={[0, 0.14, 0]} material={bodyMat} castShadow>
                  <boxGeometry args={[1.08, 0.28, 2.4]} />
                </mesh>
                {/* Tapered Cabin */}
                <mesh position={[0, 0.38, -0.15]} material={bodyMat} castShadow>
                  <boxGeometry args={[0.92, 0.25, 1.25]} />
                </mesh>
                {/* Windshield */}
                <mesh position={[0, 0.37, 0.52]} rotation={[-0.4, 0, 0]} material={materials.window}>
                  <boxGeometry args={[0.9, 0.25, 0.08]} />
                </mesh>
                <mesh position={[0, 0.37, -0.8]} rotation={[0.3, 0, 0]} material={materials.window}>
                  <boxGeometry args={[0.9, 0.25, 0.08]} />
                </mesh>
              </group>
            )}

            {/* Headlights (Front is +Z) */}
            <mesh position={[-0.38, 0.32, 1.16]} material={materials.headlight}>
              <boxGeometry args={[0.2, 0.1, 0.08]} />
            </mesh>
            <mesh position={[0.38, 0.32, 1.16]} material={materials.headlight}>
              <boxGeometry args={[0.2, 0.1, 0.08]} />
            </mesh>

            {/* Taillights (Rear is -Z) */}
            <mesh position={[-0.38, 0.32, -1.16]} material={materials.taillight}>
              <boxGeometry args={[0.2, 0.08, 0.08]} />
            </mesh>
            <mesh position={[0.38, 0.32, -1.16]} material={materials.taillight}>
              <boxGeometry args={[0.2, 0.08, 0.08]} />
            </mesh>

            {/* Night Headlight Beams */}
            {isNight && (
              <pointLight
                position={[0, 0.4, 1.5]}
                color="#ffffff"
                intensity={0.65}
                distance={8}
                decay={2}
              />
            )}

            {/* Wheels (4 rotating tires) */}
            {[
              [-0.56, 0.2, 0.7],
              [0.56, 0.2, 0.7],
              [-0.56, 0.2, -0.7],
              [0.56, 0.2, -0.7],
            ].map(([wx, wy, wz], wi) => (
              <mesh
                key={`wheel-${wi}`}
                position={[wx, wy, wz]}
                rotation={[0, 0, Math.PI / 2]}
                material={materials.wheel}
                ref={(el) => {
                  if (wheelRefs.current[idx]) wheelRefs.current[idx][wi] = el;
                }}
              >
                <cylinderGeometry args={[0.2, 0.2, 0.14, 12]} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* ── Aerial Delivery Drones & Air Cruisers ─────────────────── */}
      {[0, 1, 2].map((di) => (
        <group
          key={`drone-${di}`}
          ref={(el) => {
            droneRefs.current[di] = el;
          }}
        >
          {/* Drone Central Pod */}
          <mesh material={materials.droneBody} castShadow>
            <sphereGeometry args={[0.55, 12, 12]} />
          </mesh>
          {/* Thruster Rotors / Wings */}
          {[-0.85, 0.85].map((wingX, wi) => (
            <group key={`wing-${wi}`} position={[wingX, 0, 0]}>
              <mesh material={materials.droneBody}>
                <boxGeometry args={[0.8, 0.08, 0.2]} />
              </mesh>
              <mesh position={[0, 0.1, 0]} material={materials.droneBeacon}>
                <cylinderGeometry args={[0.28, 0.28, 0.04, 12]} />
              </mesh>
            </group>
          ))}
          {/* Pulsing Beacon Light */}
          <mesh position={[0, -0.4, 0]} material={materials.droneBeacon}>
            <sphereGeometry args={[0.12, 8, 8]} />
          </mesh>
          {isNight && (
            <pointLight position={[0, -0.5, 0]} color="#38bdf8" intensity={0.5} distance={10} />
          )}
        </group>
      ))}
    </group>
  );
}
