// Developer City — TokenTrees: one miniature tree per project that has a car.
// Sums are the token numbers already stored on those cars. A shared folder may
// repeat a session; do not split or dedupe. Waste is not measured.

import { useMemo, type CSSProperties } from 'react';
import { Html } from '@react-three/drei';
import { useCityStore } from '@/city/store';
import { plotWorldPosition } from './CityGrid';

const TRUNK = '#6b4f2a';
const CANOPY = '#3dd68c';

const LABEL: CSSProperties = {
  pointerEvents: 'none',
  fontSize: 11,
  maxWidth: 160,
  textAlign: 'center',
  lineHeight: 1.35,
  color: '#f4fff8',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  textShadow: '0 1px 3px rgba(0,0,0,0.85)',
};

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
      {sapling ? (
        <group>
          <mesh position={[0, 0.22, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.035, 0.44, 5]} />
            <meshStandardMaterial color={TRUNK} roughness={0.9} />
          </mesh>
          <group position={[0, 0.5, 0]}>
            <TokenCanopy radius={0.14} />
          </group>
        </group>
      ) : (
        <group>
          <mesh position={[0, 0.4, 0]} castShadow>
            <cylinderGeometry args={[0.055, 0.09, 0.8, 6]} />
            <meshStandardMaterial color={TRUNK} roughness={0.9} />
          </mesh>
          <group position={[0, 1.08, 0]}>
            <TokenCanopy radius={0.52} dryRatio={dryRatio} />
          </group>
        </group>
      )}
      <Html
        position={[0, sapling ? 0.82 : 1.78, 0]}
        center
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div style={LABEL}>
          {sapling ? (
            'No token count for this session.'
          ) : (
            <>
              <div>Healthy 100%</div>
              <div>Wasted 0% — Waste is not measured. We do not guess a percentage.</div>
            </>
          )}
        </div>
      </Html>
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
        position: [x - 2.4, y, z - 2.2],
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
