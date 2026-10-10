// Developer City — UserAvatar: the user's own 3D presence in the city.
// Positions at the active workspace's building, or city center if none.

import { useCityStore } from '@/city/store';
import { plotWorldPosition } from './CityGrid';
import { Html } from '@react-three/drei';

export function UserAvatar() {
  const avatar = useCityStore((s) => s.userAvatar);
  const activeWorkspacePath = useCityStore((s) => s.activeWorkspacePath);
  const projects = useCityStore((s) => s.projects);

  // Find the building for the active workspace
  const activeProject = activeWorkspacePath
    ? Object.values(projects).find((p) => p.path === activeWorkspacePath)
    : null;

  const position = activeProject
    ? (plotWorldPosition(activeProject.plot) as [number, number, number])
    : ([0, 0, 0] as const);

  return (
    <group position={position}>
      {/* body */}
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.4, 0.8, 4, 10]} />
        <meshStandardMaterial color={avatar.color} roughness={0.5} metalness={0.2} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.9, 0]}>
        <sphereGeometry args={[0.34, 16, 16]} />
        <meshStandardMaterial color={avatar.color} roughness={0.4} />
      </mesh>
      {/* "you" marker ring */}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.1, 32]} />
        <meshBasicMaterial color={avatar.color} transparent opacity={0.55} side={2} />
      </mesh>
      <Html position={[0, 3.1, 0]} center distanceFactor={40} zIndexRange={[10, 0]}>
        <div style={{
          pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700,
          color: avatar.color, textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          letterSpacing: 1,
        }}>
          YOU
        </div>
      </Html>
    </group>
  );
}