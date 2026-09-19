"use client";
// components/planner/PlannerCanvas.tsx
// Le moteur du planner : une scène three.js (React Three Fiber) avec une
// terrasse rectangulaire quadrillée et les modèles GLB posés dessus.
//
// Deux vues sur la MÊME scène (décision du 19.09 : le 2D se déduit du 3D) :
//   - « plan » : caméra orthographique vue de dessus, on compose ici ;
//   - « 3d »   : caméra perspective, pour présenter / capturer.
// Deux modes de rendu : « couleurs » (matériaux du fichier) et « maquette »
// (tout en gris mat, bouton manuel — jamais automatique).
//
// Chaque modèle est recentré au chargement : pieds à y = 0, centre de
// l'empreinte à l'origine. Les fichiers pCon passés par split_glb.py le sont
// déjà ; ceux venus de SketchUp / OBJ pas forcément. Le recentrage rend le
// planner indifférent à ce détail, et la boîte mesurée remonte au parent
// (cotes affichées, futur audit d'échelle).
//
// Chargement : useGLTF avec Draco ET meshopt (les .bin Dedon sont en meshopt).
// Les fichiers sont servis par le CDN Shopify avec les en-têtes CORS (vérifié
// le 15.09 depuis jardin-confort.ch ; à revérifier depuis offres.jardin-confort.ch
// au premier essai — c'est LE point que ce prototype valide).

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls, OrthographicCamera, PerspectiveCamera, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { SceneItem, Terrasse } from "@/lib/planner-types";

export type Dims = { l: number; p: number; h: number };

type Props = {
  items: SceneItem[];
  terrasse: Terrasse;
  vue: "plan" | "3d";
  mode: "couleurs" | "maquette";
  snap: number;                 // pas d'aimantation en m (0 = libre)
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  onMove: (uid: string, x: number, z: number) => void;
  onDims: (uid: string, dims: Dims) => void;
  onError: (uid: string, message: string) => void;
  captureRef: React.MutableRefObject<(() => string | null) | null>;
};

const CLAY = new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.95, metalness: 0 });

function arrondir(v: number, pas: number): number {
  if (!pas) return v;
  return Math.round(v / pas) * pas;
}

// ─── Un modèle posé ───────────────────────────────────────────────────────────

function Modele({
  item, mode, selected, onPointerDown, onDims,
}: {
  item: SceneItem; mode: "couleurs" | "maquette"; selected: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void; onDims: (d: Dims) => void;
}) {
  const gltf = useGLTF(item.url, true, true);
  const { objet, dims, offset } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    // Conserver les matériaux d'origine pour pouvoir basculer couleurs ⇄ maquette
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.userData.materiauOrigine = m.material;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    return {
      objet: clone,
      dims: { l: size.x, p: size.z, h: size.y },
      offset: new THREE.Vector3(-center.x, -box.min.y, -center.z),
    };
  }, [gltf]);

  // Remonter les cotes une fois par fichier chargé (ref : le parent passe une
  // nouvelle fonction à chaque rendu, on ne veut pas boucler dessus).
  const onDimsRef = useRef(onDims);
  onDimsRef.current = onDims;
  useEffect(() => { onDimsRef.current(dims); }, [dims]);

  useEffect(() => {
    objet.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = mode === "maquette" ? CLAY : (m.userData.materiauOrigine as THREE.Material);
    });
  }, [objet, mode]);

  return (
    <group position={[item.x, 0, item.z]} rotation={[0, (item.rot * Math.PI) / 180, 0]} onPointerDown={onPointerDown}>
      <primitive object={objet} position={offset} />
      {selected && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <planeGeometry args={[dims.l + 0.06, dims.p + 0.06]} />
            <meshBasicMaterial color={0x38bdf8} transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <Html position={[0, dims.h + 0.25, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded-md bg-black/75 px-2 py-1 text-[11px] text-white shadow">
              {item.titre.length > 42 ? item.titre.slice(0, 40) + "…" : item.titre}
              <span className="ml-2 text-sky-300">{Math.round(dims.l * 100)} × {Math.round(dims.p * 100)} × H {Math.round(dims.h * 100)} cm</span>
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

// Boîte rouge à la place d'un modèle qui ne charge pas (CORS, fichier absent…)
function ModeleEnErreur({ item, onPointerDown }: { item: SceneItem; onPointerDown: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group position={[item.x, 0, item.z]} rotation={[0, (item.rot * Math.PI) / 180, 0]} onPointerDown={onPointerDown}>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color={0xef4444} transparent opacity={0.6} />
      </mesh>
      <Html position={[0, 0.9, 0]} center style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap rounded-md bg-rose-600/90 px-2 py-1 text-[11px] text-white">Modèle non chargé</div>
      </Html>
    </group>
  );
}

class Garde extends React.Component<{ onError: (m: string) => void; fallback: React.ReactNode; children: React.ReactNode }, { erreur: boolean }> {
  state = { erreur: false };
  static getDerivedStateFromError() { return { erreur: true }; }
  componentDidCatch(err: Error) { this.props.onError(err.message || "Erreur de chargement"); }
  render() { return this.state.erreur ? this.props.fallback : this.props.children; }
}

// ─── Capture d'écran ──────────────────────────────────────────────────────────

function Capture({ captureRef }: { captureRef: Props["captureRef"] }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
    return () => { captureRef.current = null; };
  }, [gl, scene, camera, captureRef]);
  return null;
}

// ─── Scène ────────────────────────────────────────────────────────────────────

export default function PlannerCanvas(props: Props) {
  const { items, terrasse, vue, mode, snap, selectedUid, onSelect, onMove, onDims, onError, captureRef } = props;
  const [drag, setDrag] = useState<{ uid: string; dx: number; dz: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => {
    const fin = () => setDrag(null);
    window.addEventListener("pointerup", fin);
    return () => window.removeEventListener("pointerup", fin);
  }, []);

  const demiL = terrasse.largeur / 2;
  const demiP = terrasse.profondeur / 2;
  const zoomPlan = useMemo(() => Math.max(20, Math.min(120, 520 / Math.max(terrasse.largeur, terrasse.profondeur))), [terrasse]);

  return (
    <Canvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      dpr={[1, 2]}
      onPointerMissed={() => onSelect(null)}
      style={{ background: mode === "maquette" ? "#f3f2ef" : "#e9eef2" }}
    >
      {vue === "plan" ? (
        <OrthographicCamera makeDefault position={[0, 40, 0]} up={[0, 0, -1]} zoom={zoomPlan} near={0.1} far={200} />
      ) : (
        <PerspectiveCamera makeDefault position={[demiL + 3, 4, demiP + 5]} fov={45} near={0.05} far={200} />
      )}
      <OrbitControls
        makeDefault
        enabled={!drag}
        enableRotate={vue === "3d"}
        enableDamping={false}
        maxPolarAngle={Math.PI / 2 - 0.05}
        target={[0, 0, 0]}
        mouseButtons={{ LEFT: vue === "3d" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      />

      <hemisphereLight args={[0xffffff, 0x999999, 0.9]} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />

      {/* Terrasse + quadrillage 50 cm / 1 m */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[terrasse.largeur, terrasse.profondeur]} />
        <meshStandardMaterial color={mode === "maquette" ? 0xe8e6e1 : 0xd9c7a8} roughness={1} />
      </mesh>
      <Grid
        position={[0, 0.001, 0]}
        args={[terrasse.largeur, terrasse.profondeur]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#8b8b8b"
        sectionSize={1}
        sectionThickness={1.2}
        sectionColor="#5b5b5b"
        fadeDistance={80}
        infiniteGrid={false}
      />
      {/* Cotes de la terrasse */}
      <Html position={[0, 0.01, demiP + 0.35]} center style={{ pointerEvents: "none" }}>
        <div className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{terrasse.largeur.toFixed(2)} m</div>
      </Html>
      <Html position={[demiL + 0.35, 0.01, 0]} center style={{ pointerEvents: "none" }}>
        <div className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{terrasse.profondeur.toFixed(2)} m</div>
      </Html>

      {/* Sol invisible qui reçoit le glisser */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          onMove(d.uid, arrondir(e.point.x - d.dx, snap), arrondir(e.point.z - d.dz, snap));
        }}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {items.map((item) => {
        const debut = (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onSelect(item.uid);
          setDrag({ uid: item.uid, dx: e.point.x - item.x, dz: e.point.z - item.z });
        };
        return (
          <Garde key={item.uid} onError={(m) => onError(item.uid, m)} fallback={<ModeleEnErreur item={item} onPointerDown={debut} />}>
            <Suspense fallback={null}>
              <Modele item={item} mode={mode} selected={item.uid === selectedUid} onPointerDown={debut} onDims={(d) => onDims(item.uid, d)} />
            </Suspense>
          </Garde>
        );
      })}

      <Capture captureRef={captureRef} />
    </Canvas>
  );
}
