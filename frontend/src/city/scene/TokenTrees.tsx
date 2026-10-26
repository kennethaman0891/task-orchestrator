// Developer City — TokenTrees: one miniature tree per project that has a car.
// Sums are the token numbers already stored on those cars. A shared folder may
// repeat a session; do not split or dedupe. Waste is not measured.

import { useMemo } from 'react';
import { useCityStore } from '@/city/store';
import { plotWorldPosition } from './CityGrid';

const TRUNK = '#6b4f2a';
const CANOPY = '#3dd68c';

function finiteToken(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Green canopy. dryRatio defaults to 0; at 0 no dry meshes are created.
 * A later non-zero ratio can mix leaves without changing this call shape.
 */
function TokenCanopy({
  radius,
  dryRatio = 0,
}: {
  radius: number;
  dryRatio?: number;
}) {
  if (!(dryRatio > 0)) {
    return (
      <mesh castShadow>
        <icosahedronGeometry args={[radius, 0]} />
        <meshStandardMaterial color={CANOPY} roughness={0.75} flatShading />
      </mesh>
    );
  }
  const dry = Math.min(1, dryRatio);
  return (
    <group>
      <mesh castShadow scale={Math.max(0, 1 - dry)}>
        <icosahedronGeometry args={[radius, 0]} />
        <meshStandardMaterial color={CANOPY} roughness={0.75} flatShading />
      </mesh>
      <mesh castShadow scale={dry} position={[0.04, 0.03, 0]}>
        <icosahedronGeometry args={[radius, 0]} />
        <meshStandardMaterial color="#8a5a32" roughness={0.85} flatShading />
      </mesh>
    </group>
  );
}

function TokenTree({
  position,
  used,
  dryRatio = 0,
}: {
  position: [number, number, number];
  used: number;
  dryRatio?: number;
}) {
  const sapling = used <= 0;
  return (
    <group position={position}>
      {/* Architectural Planter Curb */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[0.65, 0.72, 0.1, 16]} />
        <meshStandardMaterial color="#334155" roughness={0.65} metalness={0.2} />
      </mesh>
      {/* Landscaped Soil / Dark Mulch */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.58, 0.58, 0.04, 16]} />
        <meshStandardMaterial color="#221811" roughness={0.95} />
      </mesh>

      {sapling ? (
        <group>
          <mesh position={[0, 0.32, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.035, 0.44, 5]} />
            <meshStandardMaterial color={TRUNK} roughness={0.9} />
          </mesh>
          <group position={[0, 0.6, 0]}>
            <TokenCanopy radius={0.18} />
          </group>
        </group>
      ) : (
        <group>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.065, 0.1, 0.9, 6]} />
            <meshStandardMaterial color={TRUNK} roughness={0.9} />
          </mesh>
          <group position={[0, 1.18, 0]}>
            <TokenCanopy radius={0.58} dryRatio={dryRatio} />
          </group>
        </group>
      )}
    </group>
  );
}

export function TokenTrees() {
  const terminalCars = useCityStore((s) => s.terminalCars);
  const projects = useCityStore((s) => s.projects);

  const trees = useMemo(() => {
    const usedByProject = new Map<string, number>();
    for (const car of Object.values(terminalCars)) {
      if (!car.projectId) continue;
      const used = finiteToken(car.tokensInput) + finiteToken(car.tokensOutput);
      usedByProject.set(car.projectId, (usedByProject.get(car.projectId) ?? 0) + used);
    }
    const placed: { projectId: string; used: number; position: [number, number, number] }[] = [];
    for (const [projectId, used] of usedByProject) {
      const project = projects[projectId];
      if (!project?.plot) continue;
      const [x, y, z] = plotWorldPosition(project.plot);
      placed.push({
        projectId,
        used,
        position: [x - 4.6, y, z - 4.6],
      });
    }
    return placed;
  }, [terminalCars, projects]);

  return (
    <group>
      {trees.map((tree) => (
        <TokenTree key={tree.projectId} position={tree.position} used={tree.used} />
      ))}
    </group>
  );
}
