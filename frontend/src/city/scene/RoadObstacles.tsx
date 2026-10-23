// Developer City — RoadObstacles: one miniature animal per temporary file
// (.bak, .tmp, .swp, trailing ~, or .DS_Store). Capped at four. No clicks.

const FUR = '#c4a574';
const MAX_ANIMALS = 4;

function isTemporaryFile(name: string): boolean {
  if (name === '.DS_Store') return true;
  return name.endsWith('.bak') || name.endsWith('.tmp') || name.endsWith('.swp') || name.endsWith('~');
}

/** Low-poly quadruped, about 0.35 tall. Feet sit on y = 0. */
function TempAnimal() {
  return (
    <group>
      <mesh position={[0, 0.165, 0]}>
        <boxGeometry args={[0.26, 0.15, 0.13]} />
        <meshStandardMaterial color={FUR} roughness={0.86} />
      </mesh>
      <mesh position={[0.12, 0.285, 0]}>
        <sphereGeometry args={[0.065, 8, 6]} />
        <meshStandardMaterial color={FUR} roughness={0.8} />
      </mesh>
      <mesh position={[0.07, 0.045, 0.04]}>
        <boxGeometry args={[0.04, 0.09, 0.04]} />
        <meshStandardMaterial color={FUR} roughness={0.9} />
      </mesh>
      <mesh position={[0.07, 0.045, -0.04]}>
        <boxGeometry args={[0.04, 0.09, 0.04]} />
        <meshStandardMaterial color={FUR} roughness={0.9} />
      </mesh>
      <mesh position={[-0.07, 0.045, 0.04]}>
        <boxGeometry args={[0.04, 0.09, 0.04]} />
        <meshStandardMaterial color={FUR} roughness={0.9} />
      </mesh>
      <mesh position={[-0.07, 0.045, -0.04]}>
        <boxGeometry args={[0.04, 0.09, 0.04]} />
        <meshStandardMaterial color={FUR} roughness={0.9} />
      </mesh>
    </group>
  );
}

export function RoadObstacles({
  position,
  files,
}: {
  position: [number, number, number];
  files: { name: string }[];
}) {
  if (!files || files.length === 0) return null;
  const temps = files.filter((file) => isTemporaryFile(file.name)).slice(0, MAX_ANIMALS);
  if (temps.length === 0) return null;

  return (
    <group position={[position[0], 0, position[2] + 2.6]}>
      {temps.map((file, index) => (
        <group key={`${file.name}-${index}`} position={[index * 0.45, 0, 0]}>
          <TempAnimal />
        </group>
      ))}
    </group>
  );
}
