// Developer City — BuildingCustomModel: renders the auto-generated 3D model
// derived from the user's custom image atop the building roof, facade, or plaza.

import { useEffect, useState, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { generate3DModelFromImage, type Generated3DModel } from '@/city/utils/imageTo3D';
import type { CustomModel3dConfig } from '@/city/types';
import type { ArchetypeSpec } from './archetypes';

interface BuildingCustomModelProps {
  config: CustomModel3dConfig;
  spec: ArchetypeSpec;
  accentColor: string;
  isNight?: boolean;
}

export function BuildingCustomModel({
  config,
  spec,
  accentColor,
  isNight = false,
}: BuildingCustomModelProps) {
  const [model, setModel] = useState<Generated3DModel | null>(null);
  const [loadError, setLoadError] = useState(false);
  const meshGroupRef = useRef<THREE.Group>(null);

  const depth = config.depth ?? 0.8;
  const placement = config.placement ?? 'rooftop';
  const spinSpeed = config.spinSpeed ?? 1;
  const scale = config.scale ?? 1.0;

  useEffect(() => {
    let cancelled = false;
    if (!config.imageUrl || !config.enabled) {
      setModel(null);
      return;
    }

    setLoadError(false);
    generate3DModelFromImage(config.imageUrl, depth, 48)
      .then((res) => {
        if (!cancelled) setModel(res);
      })
      .catch((err) => {
        console.warn('[BuildingCustomModel] 3D conversion error:', err);
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [config.imageUrl, config.enabled, depth]);

  useFrame((_, delta) => {
    if (meshGroupRef.current && spinSpeed > 0 && placement === 'rooftop') {
      meshGroupRef.current.rotation.y += delta * 0.65 * spinSpeed;
    }
  });

  const material = useMemo(() => {
    if (!model) return null;
    return new THREE.MeshStandardMaterial({
      map: model.texture,
      roughness: 0.35,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
  }, [model]);

  const pedestalMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: isNight ? '#1e293b' : '#475569',
      roughness: 0.7,
      metalness: 0.3,
    });
  }, [isNight]);

  if (!config.enabled || !config.imageUrl || loadError || !model || !material) {
    return null;
  }

  // Positioning based on placement
  if (placement === 'facade') {
    // 3D Relief plaque on front wall
    return (
      <group position={[0, spec.height * 0.62, spec.depth / 2 + 0.15]} scale={[scale * 0.7, scale * 0.7, scale * 0.7]}>
        <mesh geometry={model.geometry} material={material} castShadow receiveShadow />
      </group>
    );
  }

  if (placement === 'plaza') {
    // Monument standing in front of entrance
    return (
      <group position={[0, 0, spec.depth / 2 + 2.8]} scale={[scale * 0.8, scale * 0.8, scale * 0.8]}>
        {/* Stone Base Plinth */}
        <mesh position={[0, 0.4, 0]} material={pedestalMaterial} castShadow>
          <cylinderGeometry args={[1.6, 1.8, 0.8, 16]} />
        </mesh>
        <mesh position={[0, 0.82, 0]}>
          <ringGeometry args={[1.5, 1.7, 16]} />
          <meshBasicMaterial color={accentColor} side={THREE.DoubleSide} />
        </mesh>
        {/* 3D Model */}
        <group ref={meshGroupRef} position={[0, 2.2, 0]}>
          <mesh geometry={model.geometry} material={material} castShadow receiveShadow />
        </group>
      </group>
    );
  }

  // Default: 'rooftop' - Grand rotating 3D monument atop skyscraper
  return (
    <group position={[0, spec.height + 0.2, 0]} scale={[scale, scale, scale]}>
      {/* Rooftop Pedestal Stand */}
      <mesh position={[0, 0.45, 0]} material={pedestalMaterial} castShadow>
        <cylinderGeometry args={[1.8, 2.1, 0.9, 16]} />
      </mesh>
      {/* Accent Glowing Ring */}
      <mesh position={[0, 0.91, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.7, 1.95, 24]} />
        <meshBasicMaterial color={accentColor} side={THREE.DoubleSide} />
      </mesh>

      {/* Rotating 3D Volumetric Model */}
      <group ref={meshGroupRef} position={[0, 2.6, 0]}>
        <mesh geometry={model.geometry} material={material} castShadow receiveShadow />
      </group>

      {/* Night Accent Spotlight */}
      {isNight && (
        <pointLight position={[0, 1.2, 0]} color={accentColor} intensity={1.5} distance={12} />
      )}
    </group>
  );
}
