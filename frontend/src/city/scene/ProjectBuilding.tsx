// Developer City — ProjectBuilding: the reusable atom of the city.
// One component renders ANY project: archetype by type, colors by
// BuildingConfig (user → brand → theme cascade), logo/initials sign,
// status beacon. Externally it also hosts the plaza bots; internally it
// renders the active floor when entered. Never empty: defaults cascade.

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Detailed, Html } from '@react-three/drei';
import { archetypeFor, useBuildingMaterials, windowGrid, type ArchetypeSpec } from './archetypes';
import { themeById } from '@/city/themes';
import { projectDisplayName, type AgentBot, type Project } from '@/city/types';
import { InteriorFloor } from './Interior';
import { useCityStore } from '@/city/store';
import { PlazaBots } from './Bots';
import { BuildingCustomModel } from './BuildingCustomModel';
import { imageBlobUrl } from '@/lib/api';

export interface ProjectBuildingProps {
  project: Project;
  /** World position of this plot's centre */
  position: [number, number, number];
  selected?: boolean;
  dimmed?: boolean;
  agentActive?: boolean;
  /** When entered (interior nav), the floor to show inside. null = exterior. */
  interiorFloor?: number | null;
  agents?: AgentBot[];
  /** True when this building is the user's current workspace (sidebar) */
  workspaceActive?: boolean;
  onPointerDown?: (e: any) => void;
  onDoubleClick?: (e: any) => void;
}

function healthColor(p: Project): string {
  if (p.status === 'archived') return '#6b7280';
  if (p.health === 'failed') return '#f43f5e';
  if (p.health === 'degraded') return '#f59e0b';
  if (p.status === 'paused') return '#94a3b8';
  return '#22c55e';
}

/** Canvas texture: logo image if available, else brand-color initials. */
function useSignTexture(project: Project, themeId: string, signBg?: string | null): THREE.CanvasTexture {
  const b = project.building;
  const texture = useMemo(() => {
    const t = themeById(themeId);
    const bg = signBg || t.trim;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = t.accent;
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initials = (projectDisplayName(project).slice(0, 2).toUpperCase() || '??');
    ctx.fillText(initials, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (b.logo) {
      const src = b.logo.startsWith('http') || b.logo.startsWith('blob:') || b.logo.startsWith('data:')
        ? b.logo
        : imageBlobUrl(b.logo);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.clearRect(0, 0, 128, 128);
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 128, 128);
          const s = Math.min(112, Math.min(img.width, img.height));
          ctx.drawImage(img, 64 - s / 2, 64 - s / 2, s, s);
          ctx.fillStyle = t.accent;
          ctx.font = 'bold 18px sans-serif';
          ctx.fillText(initials, 64, 112);
          tex.needsUpdate = true;
        } catch { /* keep initials on tainted canvas */ }
      };
      img.src = src;
    }
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.logo, themeId, signBg]);
  return texture;
}

function WindowInstances({ spec, glass }: { spec: ArchetypeSpec; glass: THREE.MeshStandardMaterial }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const grid = useMemo(() => windowGrid(spec), [spec]);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    if (m.userData.initialized) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 0, 1);
    grid.positions.forEach((pos, i) => {
      q.setFromAxisAngle(up, grid.rotY[i]);
      mat.compose(pos, q, new THREE.Vector3(1, 1, 1));
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.userData.initialized = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined as unknown as THREE.BufferGeometry, undefined as unknown as THREE.Material, grid.positions.length]}
      frustumCulled={false}
      userData={{ initialized: false }}
    >
      <planeGeometry args={[0.9, 0.7]} />
      <primitive object={glass} attach="material" />
    </instancedMesh>
  );
}

function RoofFeature({ spec, accent, trim }: { spec: ArchetypeSpec; accent: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial }) {
  const top = spec.height;
  switch (spec.feature) {
    case 'clockTower':
      return (
        <group position={[0, top, 0]}>
          <mesh position={[0, 1.2, 0]} material={accent}>
            <cylinderGeometry args={[0.9, 1.1, 2.4, 8]} />
          </mesh>
          <mesh position={[0, 3.0, 0]} material={trim}>
            <coneGeometry args={[1.2, 1.4, 8]} />
          </mesh>
        </group>
      );
    case 'awning':
      return (
        <group>
          <mesh position={[0, 1.0, spec.depth / 2 + 0.5]} material={accent}>
            <boxGeometry args={[spec.width, 0.25, 1.2]} />
          </mesh>
        </group>
      );
    case 'antenna':
      return (
        <group position={[0, top, 0]}>
          <mesh position={[0, 1.4, 0]} material={trim}>
            <cylinderGeometry args={[0.08, 0.14, 2.8, 6]} />
          </mesh>
          <mesh position={[0, 2.9, 0]} material={accent}>
            <sphereGeometry args={[0.22, 8, 8]} />
          </mesh>
        </group>
      );
    case 'garden':
      return (
        <group position={[0, top, 0]}>
          <mesh position={[0, 0.15, 0]} material={accent}>
            <boxGeometry args={[spec.width * 0.85, 0.3, spec.depth * 0.85]} />
          </mesh>
          <mesh position={[-spec.width * 0.2, 0.55, spec.depth * 0.15]} material={accent}>
            <sphereGeometry args={[0.5, 8, 8]} />
          </mesh>
        </group>
      );
    case 'beacon':
      return (
        <group position={[0, top, 0]}>
          <mesh position={[0, 0.9, 0]} material={trim}>
            <cylinderGeometry args={[0.35, 0.5, 1.8, 8]} />
          </mesh>
          <mesh position={[0, 2.0, 0]} material={accent}>
            <sphereGeometry args={[0.35, 10, 10]} />
          </mesh>
        </group>
      );
    default:
      return (
        <mesh position={[0, top + 0.2, 0]} material={trim}>
          <boxGeometry args={[spec.width + 0.3, 0.4, spec.depth + 0.3]} />
        </mesh>
      );
  }
}

export function ProjectBuilding({
  project, position, selected, dimmed, agentActive,
  interiorFloor = null, agents = [],
  workspaceActive = false,
  onPointerDown, onDoubleClick,
}: ProjectBuildingProps) {
  const openContextMenu = useCityStore((s) => s.openContextMenu);
  const cityMood = useCityStore((s) => s.cityMood);

  const handleContextMenu = (e: any) => {
    const ne = e.nativeEvent ?? e;
    ne.preventDefault?.();   // suppress WKWebView native menu
    e.stopPropagation();
    openContextMenu(project.id, ne.clientX, ne.clientY);
  };
  const b = project.building;
  const theme = themeById(b.theme);
  // Palette: 8 user color slots (see BuildingConfig.palette), empty slot = inherit.
  const pal = (i: number): string => b.palette?.[i] || '';
  // Color cascade: explicit user colors → brand-extracted → palette → theme.
  const facade = b.primaryColor || (b.brandColors?.primary ?? null) || pal(0) || theme.facade;
  const facadeDark = pal(1) || theme.facadeDark;
  const glass = b.secondaryColor || pal(2) || theme.glass;
  const accent = b.accentColor || (b.brandColors?.accent ?? null) || pal(3) || theme.accent;

  const spec = useMemo(() => {
    const s = archetypeFor(b.buildingStyle || project.type, project.type);
    const k = Math.max(0.4, Math.min(2.2, b.scale || 1));
    return { ...s, width: s.width * k, height: s.height * k, depth: s.depth * k, floorH: s.floorH * k };
  }, [b.buildingStyle, b.scale, project.type]);

  const mats = useBuildingMaterials(facade, facadeDark, glass, accent, {
    glow: pal(4) || undefined,
    signBg: pal(6) || undefined,
    trim: pal(7) || undefined,
  });
  const beacon = healthColor(project);
  const sign = useSignTexture(project, b.theme, pal(6) || null);
  const rot = ((b.rotation || 0) * Math.PI) / 180;

  const beaconRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (agentActive && beaconRef.current) {
      beaconRef.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.35);
    } else if (beaconRef.current) {
      beaconRef.current.scale.setScalar(1);
    }
  });

  const activeBots = agents.filter((a) => a.status !== 'offline');
  const exterior = interiorFloor === null;

  const tower = exterior ? (
    <group rotation={[0, rot, 0]}>
      <mesh position={[0, spec.height / 2, 0]} material={mats.wall} castShadow receiveShadow
        onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}
        onContextMenu={handleContextMenu}
        frustumCulled={false}>
        <boxGeometry args={[spec.width, spec.height, spec.depth]} />
      </mesh>
      <mesh position={[0, 0.25, 0]} material={mats.wallDark}>
        <boxGeometry args={[spec.width + 0.8, 0.5, spec.depth + 0.8]} />
      </mesh>
      <WindowInstances spec={spec} glass={mats.glass} />
      <RoofFeature spec={spec} accent={mats.accent} trim={mats.trim} />
      {b.customModel3d?.enabled && b.customModel3d?.imageUrl && (
        <BuildingCustomModel
          config={b.customModel3d}
          spec={spec}
          accentColor={accent}
          isNight={cityMood === 'night'}
        />
      )}
      {sign && (
        <mesh position={[0, spec.height * 0.55, spec.depth / 2 + 0.08]} frustumCulled={false}>
          <planeGeometry args={[Math.min(2.4, spec.width * 0.5), Math.min(2.4, spec.width * 0.5)]} />
          <meshStandardMaterial map={sign} transparent roughness={0.6} />
        </mesh>
      )}
    </group>
  ) : (
    <group rotation={[0, rot, 0]}>
      {/* entered: roof + active floor interior */}
      <mesh position={[0, spec.height + 0.15, 0]} material={mats.trim} frustumCulled={false}>
        <boxGeometry args={[spec.width + 0.6, 0.3, spec.depth + 0.6]} />
      </mesh>
      <InteriorFloor
        project={project}
        floorIndex={interiorFloor}
        width={spec.width}
        depth={spec.depth}
        floorH={spec.floorH}
        agents={activeBots}
      />
      <RoofFeature spec={spec} accent={mats.accent} trim={mats.trim} />
    </group>
  );

  const detailed = (
    <>
      {tower}
      {/* status beacon on roof */}
      <mesh ref={beaconRef} position={[0, spec.height + (spec.feature === 'clockTower' ? 4.4 : spec.feature === 'antenna' ? 3.2 : 1.1), 0]}>
        <sphereGeometry args={[0.3, 10, 10]} />
        <meshStandardMaterial color={beacon} emissive={beacon} emissiveIntensity={agentActive ? 2.2 : 1.1} />
      </mesh>
      {/* user plaza ring (palette slot 5) */}
      {pal(5) && (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(spec.width, spec.depth) * 0.55, Math.max(spec.width, spec.depth) * 0.8, 48]} />
          <meshBasicMaterial color={pal(5)} transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* selection ring */}
      {selected && (
        <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(spec.width, spec.depth) * 0.75, Math.max(spec.width, spec.depth) * 0.75 + 0.35, 40]} />
          <meshBasicMaterial color={accent} transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* plaza bots stand around the building */}
      {exterior && activeBots.length > 0 && <PlazaBots bots={activeBots} offset={selected ? 4 : 0} />}
    </>
  );

  return (
    <group position={position}>
        <Detailed distances={[0, 200]}>
          {detailed}
          {/* far LOD: single box, zero detail */}
          <group rotation={[0, rot, 0]}>
            <mesh position={[0, spec.height / 2, 0]} material={mats.wall} frustumCulled={false}
              onContextMenu={handleContextMenu}>
              <boxGeometry args={[spec.width, spec.height, spec.depth]} />
            </mesh>
          </group>
        </Detailed>
        {(selected || !dimmed) && (
          <Html position={[0, spec.height + 5.4, 0]} center distanceFactor={40} zIndexRange={[10, 0]}>
            <div
              style={{
                pointerEvents: 'none', whiteSpace: 'nowrap', textAlign: 'center',
                fontSize: 12, fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.3s',
              }}
            >
              <div style={{ fontWeight: 600, letterSpacing: 0.2 }}>{projectDisplayName(project)}</div>
              <div style={{ fontSize: 10, opacity: 0.75, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                {project.type}
              </div>
              {workspaceActive && (
                <div style={{
                  marginTop: 3, display: 'inline-block', padding: '1px 8px', borderRadius: 999,
                  background: 'rgba(34,197,94,0.22)', border: '1px solid rgba(34,197,94,0.65)',
                  color: '#86efac', fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                }}>
                  ● current workspace
                </div>
              )}
            </div>
          </Html>
        )}
    </group>
  );
}
