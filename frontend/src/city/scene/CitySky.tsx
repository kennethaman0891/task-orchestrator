// Developer City — CitySky: atmospheric sky dome, radiant 3D Sun (Daytime),
// cratered 3D Moon + twinkling starfield (Nighttime), and directional lighting.

import { useMemo, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { useCityStore } from '@/city/store';

function createRadialGlowTexture(stops: Array<[number, string]>): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [offset, color] of stops) {
    grad.addColorStop(offset, color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSunRaysTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const half = size / 2;
  ctx.translate(half, half);
  const rayCount = 16;
  for (let i = 0; i < rayCount; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / rayCount);
    const grad = ctx.createLinearGradient(0, 0, half, 0);
    grad.addColorStop(0, 'rgba(255, 248, 214, 0.36)');
    grad.addColorStop(0.4, 'rgba(253, 224, 71, 0.14)');
    grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(half, -16);
    ctx.lineTo(half, 16);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMoonSurfaceTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Bright lunar regolith base
  ctx.fillStyle = '#e8eef5';
  ctx.fillRect(0, 0, w, h);

  // Lunar Maria (dark basaltic plains)
  const maria = [
    [76, 44, 24, 18],
    [108, 52, 20, 14],
    [136, 42, 28, 22],
    [170, 58, 22, 16],
    [58, 72, 18, 13],
    [195, 38, 16, 12],
  ];
  for (const [x, y, rx, ry] of maria) {
    const grad = ctx.createRadialGradient(x, y, 2, x, y, Math.max(rx, ry));
    grad.addColorStop(0, 'rgba(100, 116, 139, 0.55)');
    grad.addColorStop(1, 'rgba(148, 163, 184, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // Impact craters with subtle rim highlights
  for (let i = 0; i < 42; i++) {
    const cx = ((i * 53 + 17) % (w - 16)) + 8;
    const cy = ((i * 37 + 11) % (h - 20)) + 10;
    const r = 2 + (i % 5) * 1.4;
    ctx.fillStyle = 'rgba(100, 116, 139, 0.34)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx - 0.5, cy - 0.5, r, Math.PI * 0.8, Math.PI * 1.8);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uMidColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uCelestialDir;
  uniform vec3 uGlowColor;
  uniform float uGlowStrength;
  varying vec3 vWorldDir;

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = clamp(dir.y, 0.0, 1.0);

    // Smooth atmospheric vertical gradient from horizon -> mid sky -> zenith
    vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));
    col = mix(col, uTopColor, smoothstep(0.22, 0.88, h));

    // Mie-like atmospheric scattering halo around Sun or Moon
    float cosTheta = max(dot(dir, normalize(uCelestialDir)), 0.0);
    float wideGlow = pow(cosTheta, 5.0) * 0.35 * uGlowStrength;
    float tightGlow = pow(cosTheta, 36.0) * 0.65 * uGlowStrength;
    col += uGlowColor * (wideGlow + tightGlow);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function CitySky() {
  const cityMood = useCityStore((s) => s.cityMood);
  const isNight = cityMood === 'night';
  const { scene } = useThree();

  // Prominent forward-sky positions above the city horizon so both Sun (Day)
  // and Moon (Night) are clearly visible across Overview, Street, and Focus views.
  const sunPosition = useMemo(() => new THREE.Vector3(-110, 56, -150), []);
  const moonPosition = useMemo(() => new THREE.Vector3(-105, 60, -150), []);

  // Primary shadow-casting directional key light angled from upper front-right
  // so camera-facing facades receive crisp 3D sunlight/moonlight & shadows.
  const dayKeyPosition = useMemo(() => new THREE.Vector3(95, 135, 85), []);
  const nightKeyPosition = useMemo(() => new THREE.Vector3(80, 120, 70), []);

  const sunRaysRef = useRef<THREE.Sprite>(null);
  const sunLightRef = useRef<THREE.DirectionalLight>(null);
  const moonLightRef = useRef<THREE.DirectionalLight>(null);

  const [lightTarget] = useState(() => {
    const obj = new THREE.Object3D();
    obj.position.set(0, 0, 0);
    return obj;
  });

  useEffect(() => {
    scene.add(lightTarget);
    return () => {
      scene.remove(lightTarget);
    };
  }, [scene, lightTarget]);

  useEffect(() => {
    if (sunLightRef.current) sunLightRef.current.target = lightTarget;
    if (moonLightRef.current) moonLightRef.current.target = lightTarget;
  }, [lightTarget, isNight]);

  const sunGlowTex = useMemo(
    () =>
      createRadialGlowTexture([
        [0.0, 'rgba(255, 254, 240, 1.0)'],
        [0.18, 'rgba(254, 240, 138, 0.88)'],
        [0.45, 'rgba(251, 191, 36, 0.34)'],
        [0.75, 'rgba(245, 158, 11, 0.08)'],
        [1.0, 'rgba(245, 158, 11, 0.0)'],
      ]),
    [],
  );

  const sunRaysTex = useMemo(() => createSunRaysTexture(), []);

  const moonGlowTex = useMemo(
    () =>
      createRadialGlowTexture([
        [0.0, 'rgba(241, 245, 249, 0.72)'],
        [0.24, 'rgba(147, 197, 253, 0.36)'],
        [0.6, 'rgba(59, 130, 246, 0.1)'],
        [1.0, 'rgba(30, 58, 138, 0.0)'],
      ]),
    [],
  );

  const moonSurfaceTex = useMemo(() => createMoonSurfaceTexture(), []);

  const skyUniforms = useMemo(
    () => ({
      uTopColor: { value: new THREE.Color('#2563eb') },
      uMidColor: { value: new THREE.Color('#60a5fa') },
      uHorizonColor: { value: new THREE.Color('#cfe6fc') },
      uCelestialDir: { value: new THREE.Vector3(-110, 56, -150).normalize() },
      uGlowColor: { value: new THREE.Color('#fef3c7') },
      uGlowStrength: { value: 1.0 },
    }),
    [],
  );

  useEffect(() => {
    if (isNight) {
      skyUniforms.uTopColor.value.set('#040711');
      skyUniforms.uMidColor.value.set('#0a1226');
      skyUniforms.uHorizonColor.value.set('#141f38');
      skyUniforms.uCelestialDir.value.copy(moonPosition).normalize();
      skyUniforms.uGlowColor.value.set('#93c5fd');
      skyUniforms.uGlowStrength.value = 0.55;
    } else {
      skyUniforms.uTopColor.value.set('#2264ba');
      skyUniforms.uMidColor.value.set('#5ea8f0');
      skyUniforms.uHorizonColor.value.set('#cfe6fc');
      skyUniforms.uCelestialDir.value.copy(sunPosition).normalize();
      skyUniforms.uGlowColor.value.set('#fde68a');
      skyUniforms.uGlowStrength.value = 1.05;
    }
  }, [isNight, moonPosition, skyUniforms, sunPosition]);

  useFrame(({ clock }) => {
    if (sunRaysRef.current && !isNight) {
      sunRaysRef.current.material.rotation = clock.elapsedTime * 0.06;
    }
  });

  return (
    <group>
      {/* ── Atmospheric Sky Dome (Day Gradient + Sun Halo / Night Indigo) ── */}
      <mesh frustumCulled={false} renderOrder={-10}>
        <sphereGeometry args={[460, 48, 32]} />
        <shaderMaterial
          vertexShader={SKY_VERTEX_SHADER}
          fragmentShader={SKY_FRAGMENT_SHADER}
          uniforms={skyUniforms}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      {/* ── 1. The Radiant 3D Sun (Daytime) ────────────────────────── */}
      {!isNight && (
        <>
          <group position={sunPosition.toArray()}>
            {/* Crisp Luminous Solar Sphere */}
            <mesh>
              <sphereGeometry args={[9.5, 32, 32]} />
              <meshBasicMaterial color="#fffef2" fog={false} />
            </mesh>

            {/* Smooth Additive Corona Halo */}
            {sunGlowTex && (
              <sprite scale={[78, 78, 1]}>
                <spriteMaterial
                  map={sunGlowTex}
                  transparent
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  fog={false}
                />
              </sprite>
            )}

            {/* Gentle Animated Solar Rays */}
            {sunRaysTex && (
              <sprite ref={sunRaysRef} scale={[108, 108, 1]}>
                <spriteMaterial
                  map={sunRaysTex}
                  transparent
                  opacity={0.75}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  fog={false}
                />
              </sprite>
            )}
          </group>

          {/* Primary Shadow-Casting Sunlight onto City Facades */}
          <directionalLight
            ref={sunLightRef}
            position={dayKeyPosition.toArray()}
            color="#fff7e6"
            intensity={1.95}
            castShadow
            shadow-bias={-0.00015}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-95}
            shadow-camera-right={95}
            shadow-camera-top={95}
            shadow-camera-bottom={-95}
            shadow-camera-near={80}
            shadow-camera-far={450}
          />
          {/* Warm Rim Light from the Visible Sun */}
          <directionalLight position={sunPosition.toArray()} color="#fde68a" intensity={0.65} />
          {/* Cool Sky Fill Light */}
          <directionalLight position={[-75, 65, 55]} color="#bae6fd" intensity={0.38} />
        </>
      )}

      {/* ── 2. The Luminous 3D Moon & Starfield (Nighttime) ─────────── */}
      {isNight && (
        <>
          <group position={moonPosition.toArray()}>
            {/* Textured Cratered Moon Sphere */}
            <mesh rotation={[0.15, -0.4, 0.1]}>
              <sphereGeometry args={[9, 32, 32]} />
              <meshStandardMaterial
                map={moonSurfaceTex ?? undefined}
                emissiveMap={moonSurfaceTex ?? undefined}
                color="#f1f5f9"
                emissive="#dbeafe"
                emissiveIntensity={1.15}
                roughness={0.85}
                metalness={0.05}
                fog={false}
              />
            </mesh>

            {/* Smooth Moonlight Halo */}
            {moonGlowTex && (
              <sprite scale={[64, 64, 1]}>
                <spriteMaterial
                  map={moonGlowTex}
                  transparent
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  fog={false}
                />
              </sprite>
            )}
          </group>

          {/* Primary Shadow-Casting Moonlight onto the City */}
          <directionalLight
            ref={moonLightRef}
            position={nightKeyPosition.toArray()}
            color="#93c5fd"
            intensity={1.15}
            castShadow
            shadow-bias={-0.00015}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-95}
            shadow-camera-right={95}
            shadow-camera-top={95}
            shadow-camera-bottom={-95}
            shadow-camera-near={80}
            shadow-camera-far={450}
          />
          {/* Subtle Lunar Rim Light */}
          <directionalLight position={moonPosition.toArray()} color="#bfdbfe" intensity={0.45} />

          {/* Shimmering Multi-Depth Celestial Stars */}
          <Stars
            radius={320}
            depth={80}
            count={3200}
            factor={4.5}
            saturation={0.35}
            fade
            speed={0.65}
          />
        </>
      )}
    </group>
  );
}
