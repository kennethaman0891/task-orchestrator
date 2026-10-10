// Developer City — AgentBots: AI agents as 3D entities.
// One small robot per agent, placed by REAL state:
//   - exterior: the bot stands on the building's plaza, walking ring
//   - interior: the bot sits in the room named by the agent's task data
// Appearance encodes status (light color + idle motion). No fake
// "thinking" theater: motion state maps 1:1 to real agent state.

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AgentBot } from '@/city/types';

const STATUS_LIGHT: Record<string, string> = {
  idle: '#94a3b8',
  thinking: '#60a5fa',
  working: '#f59e0b',
  waiting: '#fbbf24',
  completed: '#22c55e',
  failed: '#f43f5e',
  offline: '#475569',
};

function Bot({ bot, index, small }: { bot: AgentBot; index: number; small?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.Mesh>(null);
  const s = small ? 0.55 : 0.8;
  const color = STATUS_LIGHT[bot.status] || '#94a3b8';

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    // Motion is a function of REAL state:
    //  working → in-place step cycle; thinking → slow bob; failed → shake;
    //  idle/waiting/completed/offline → still.
    const t = clock.elapsedTime;
    if (bot.status === 'working') {
      g.position.y = Math.abs(Math.sin(t * 5 + index)) * 0.12;
      g.rotation.y = Math.sin(t * 0.7 + index) * 0.25;
    } else if (bot.status === 'thinking') {
      g.position.y = Math.sin(t * 1.5 + index) * 0.06 + 0.06;
      g.rotation.y = 0;
    } else if (bot.status === 'failed') {
      g.rotation.z = Math.sin(t * 18 + index) * 0.06;
    } else {
      g.position.y = 0;
      g.rotation.z = 0;
    }
    if (lightRef.current) {
      const mat = lightRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = bot.status === 'working'
        ? 1.6 + Math.sin(t * 6) * 0.9
        : 1.2;
    }
  });

  return (
    <group ref={group} scale={s}>
      {/* body */}
      <mesh position={[0, 0.55, 0]}>
        <capsuleGeometry args={[0.32, 0.5, 4, 10]} />
        <meshStandardMaterial color="#39415a" roughness={0.5} metalness={0.35} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.15, 0]}>
        <boxGeometry args={[0.5, 0.4, 0.45]} />
        <meshStandardMaterial color="#222839" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* face visor */}
      <mesh position={[0, 1.15, 0.23]}>
        <planeGeometry args={[0.4, 0.22]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.1} />
      </mesh>
      {/* status light */}
      <mesh ref={lightRef} position={[0, 1.45, 0]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
      </mesh>
      {/* legs */}
      <mesh position={[-0.14, 0.08, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 6]} />
        <meshStandardMaterial color="#1d2233" />
      </mesh>
      <mesh position={[0.14, 0.08, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 6]} />
        <meshStandardMaterial color="#1d2233" />
      </mesh>
    </group>
  );
}

/** Bots standing on the plaza around a building (exterior mode). */
export function PlazaBots({ bots, offset = 0 }: { bots: AgentBot[]; offset?: number }) {
  const ring = Math.max(7 + offset, bots.length * 3.2 + 4);
  return (
    <group>
      {bots.slice(0, 12).map((bot, i) => {
        const a = (i / Math.max(1, Math.min(bots.length, 12))) * Math.PI * 2 + 0.5;
        return (
          <group key={bot.id} position={[Math.cos(a) * ring * 0.45, 0, Math.sin(a) * ring * 0.45]}>
            <Bot bot={bot} index={i} />
          </group>
        );
      })}
      {bots.length > 12 && (
        <group position={[0, 0, 0]}>
          {/* keep it a plain marker — no extra DOM */}
          <mesh position={[0, 0.05, 0]}>
            <sphereGeometry args={[0.2, 6, 6]} />
            <meshBasicMaterial color="#8ab4ff" transparent opacity={0.5} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** Bots placed inside one room (interior mode). */
export function AgentBots({ bots, small }: { bots: AgentBot[]; small?: boolean }) {
  return (
    <group>
      {bots.slice(0, 8).map((bot, i) => (
        <group key={bot.id} position={[(i - 1) * 0.9, 0, 0]}>
          <Bot bot={bot} index={i} small={small} />
        </group>
      ))}
    </group>
  );
}
