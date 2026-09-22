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
import { SOLS, type SceneItem, type SolId, type Terrasse } from "@/lib/planner-types";

export type Dims = { l: number; p: number; h: number };

type Props = {
  items: SceneItem[];
  terrasse: Terrasse;
  vue: "plan" | "3d";
  mode: "couleurs" | "maquette";
  sol: SolId;
  snap: number;                 // pas d'aimantation en m (0 = libre)
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  onDragStart: () => void;
  onMove: (uid: string, x: number, z: number) => void;
  onDims: (uid: string, dims: Dims) => void;
  onError: (uid: string, message: string) => void;
  captureRef: React.MutableRefObject<(() => string | null) | null>;
  // Calque « meubles seuls » (fond transparent, sol remplacé par un récepteur
  // d'ombres) pour l'ambiance IA : sert de masque et se recolle sur l'image.
  calqueRef?: React.MutableRefObject<(() => string | null) | null>;
  // Paire capture + calque prise avec la caméra « photo » d'ambiance (hauteur
  // d'œil, bord avant de la terrasse hors champ) — vue 3D seulement.
  ambianceRef?: React.MutableRefObject<(() => { capture: string; calque: string } | null) | null>;
  recadrerRef: React.MutableRefObject<(() => void) | null>;   // « Recadrer » : toute la terrasse dans la vue
  lectureSeule?: boolean;       // page client : on regarde, on tourne, on zoome — on ne touche à rien
};

function rotationY(item: SceneItem): number {
  return ((item.rot + (item.rot_fix || 0)) * Math.PI) / 180;
}

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
    <group position={[item.x, 0, item.z]} rotation={[0, rotationY(item), 0]} onPointerDown={onPointerDown}>
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
    <group position={[item.x, 0, item.z]} rotation={[0, rotationY(item), 0]} onPointerDown={onPointerDown}>
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

// ─── Texture du sol ───────────────────────────────────────────────────────────
// Texture procédurale (1 tuile = 1 m) : lames de bois, dalles, béton, gravier,
// gazon. Sert à la vue normale et surtout à l'ambiance IA, où la terrasse est
// recollée telle quelle sur le décor généré (l'IA ne touche pas à la terrasse,
// elle ne génère que ce qu'il y a au-delà de ses bords).

function useTextureSol(sol: SolId, mode: Props["mode"], largeur: number, profondeur: number): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (mode === "maquette" || typeof document === "undefined") return null;
    const N = 512;
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const base = SOLS.find((x) => x.id === sol)?.couleur || "#c9a678";
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, N, N);
    const grain = (n: number, amp: number, taille = 2, clair = false) => {
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(${clair ? "255,255,255" : "0,0,0"},${Math.random() * amp})`;
        ctx.fillRect(Math.random() * N, Math.random() * N, taille, taille);
      }
    };
    if (sol === "bois") {
      const lame = 72;                                   // ≈ 14 cm
      for (let y = 0; y < N; y += lame) {
        ctx.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.09})`;
        ctx.fillRect(0, y, N, lame);
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(0, y, N, 3);                        // joint
      }
      ctx.strokeStyle = "rgba(0,0,0,0.07)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 90; i++) {                     // veinage
        const y = Math.random() * N;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(N / 3, y + Math.random() * 6 - 3, (2 * N) / 3, y + Math.random() * 6 - 3, N, y);
        ctx.stroke();
      }
    } else if (sol === "pierre" || sol === "blanc" || sol === "beton") {
      const t = sol === "beton" ? N : N / 2;             // dalles 50 cm, béton 1 m
      for (let y = 0; y < N; y += t) for (let x = 0; x < N; x += t) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
        ctx.fillRect(x, y, t, t);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = 3;
      for (let k = 0; k <= N; k += t) {
        ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, N); ctx.moveTo(0, k); ctx.lineTo(N, k); ctx.stroke();
      }
      grain(5000, 0.08);
    } else if (sol === "gravier") {
      grain(20000, 0.25);
      grain(9000, 0.3, 2, true);
    } else if (sol === "gazon") {
      for (let i = 0; i < 30000; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? "0,60,0" : "130,190,50"},${Math.random() * 0.35})`;
        ctx.fillRect(Math.random() * N, Math.random() * N, 1, 3);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(largeur, profondeur);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [sol, mode, largeur, profondeur]);
}

// ─── Capture d'écran ──────────────────────────────────────────────────────────

type RefMesh = React.RefObject<THREE.Object3D | null>;

function Capture({ captureRef, calqueRef, ambianceRef, grilleRef, ombreRef, terrasse }: {
  captureRef: Props["captureRef"]; calqueRef?: Props["calqueRef"]; ambianceRef?: Props["ambianceRef"]; grilleRef: RefMesh; ombreRef: RefMesh; terrasse: Terrasse;
}) {
  const { gl, scene, camera, controls } = useThree();
  useEffect(() => {
    // Rendu « meubles + terrasse, sans grille, fond transparent » avec la
    // caméra passée (voir calqueRef ci-dessous pour le pourquoi).
    const rendreCalque = (cam: THREE.Camera) => {
      const g = grilleRef.current, o = ombreRef.current;
      const vg = g?.visible ?? true;
      if (g) g.visible = false;
      if (o) o.visible = true;
      gl.render(scene, cam);
      const data = gl.domElement.toDataURL("image/png");
      if (g) g.visible = vg;
      if (o) o.visible = false;
      return data;
    };
    if (ambianceRef) {
      // Caméra photo : hauteur d'œil 2 m, même azimut que la vue courante (le
      // conseiller tourne la vue pour choisir le côté qui regarde le lac),
      // placée à 1 m du bord de la terrasse, légèrement piquée (6°) → le bord
      // avant sort du cadre en bas, l'horizon est vers 40 % du haut. L'IA n'a
      // alors que le paysage au-delà du bord arrière et des côtés à peindre :
      // plus de « deuxième terrasse » inventée sous le bord avant.
      ambianceRef.current = () => {
        const cam = camera as THREE.PerspectiveCamera;
        if (!cam.isPerspectiveCamera) return null;                  // vue plan : pas d'ambiance
        const pos0 = cam.position.clone(), quat0 = cam.quaternion.clone();
        const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
        const az = Math.atan2(cam.position.x, cam.position.z);
        const d = 0.5 * Math.min(terrasse.largeur, terrasse.profondeur) + 1.0;
        cam.position.set(Math.sin(az) * d, 2.0, Math.cos(az) * d);
        const pique = (6 * Math.PI) / 180;
        const dir = new THREE.Vector3(-Math.sin(az), -Math.tan(pique), -Math.cos(az)).normalize();
        cam.lookAt(cam.position.clone().add(dir));
        cam.updateMatrixWorld();
        gl.render(scene, cam);
        const capture = gl.domElement.toDataURL("image/png");
        const calque = rendreCalque(cam);
        cam.position.copy(pos0);
        cam.quaternion.copy(quat0);
        cam.updateMatrixWorld();
        if (ctrl) ctrl.update();
        gl.render(scene, camera);
        return { capture, calque };
      };
    }
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
    if (calqueRef) {
      // Même caméra, même taille que la capture prise juste avant : on cache
      // la grille, on montre le plan « ombres seules » (pour les articles posés
      // hors terrasse), on lit le canvas — fond transparent (le canvas est
      // alpha, le gris vient du CSS), terrasse texturée et meubles opaques —
      // puis on remet tout et on redessine la vue normale.
      // La terrasse fait partie du calque : l'IA ne génère que le décor autour
      // et la géométrie (sol + meubles) est recollée telle quelle.
      calqueRef.current = () => {
        const data = rendreCalque(camera);
        gl.render(scene, camera);
        return data;
      };
    }
    return () => { captureRef.current = null; if (calqueRef) calqueRef.current = null; if (ambianceRef) ambianceRef.current = null; };
  }, [gl, scene, camera, controls, captureRef, calqueRef, ambianceRef, grilleRef, ombreRef, terrasse]);
  return null;
}

// ─── Recadrage ────────────────────────────────────────────────────────────────
// Remet la caméra sur toute la terrasse (bouton « Recadrer » : on se perd vite
// à la molette). En plan : zoom calculé sur la taille réelle du canvas ; en
// 3D : point de vue de départ. Cible d'OrbitControls remise au centre.

function Recadrage({ recadrerRef, terrasse, vue }: { recadrerRef: Props["recadrerRef"]; terrasse: Terrasse; vue: Props["vue"] }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    recadrerRef.current = () => {
      const ctrl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      if (vue === "plan" && (camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const cam = camera as THREE.OrthographicCamera;
        const marge = 1.6; // m de chaque côté (cotes + bande de dépôt)
        cam.zoom = Math.max(5, Math.min(size.width / (terrasse.largeur + 2 * marge), size.height / (terrasse.profondeur + 2 * marge)));
        cam.position.set(0, 40, 0);
        cam.updateProjectionMatrix();
      } else {
        camera.position.set(terrasse.largeur / 2 + 3, 4, terrasse.profondeur / 2 + 5);
      }
      if (ctrl) { ctrl.target.set(0, 0, 0); ctrl.update(); }
      camera.lookAt(0, 0, 0);
    };
    return () => { recadrerRef.current = null; };
  }, [camera, size, controls, terrasse, vue, recadrerRef]);
  return null;
}

// ─── Scène ────────────────────────────────────────────────────────────────────

export default function PlannerCanvas(props: Props) {
  const { items, terrasse, vue, mode, sol, snap, selectedUid, onSelect, onDragStart, onMove, onDims, onError, captureRef, calqueRef, ambianceRef, recadrerRef, lectureSeule = false } = props;
  const [drag, setDrag] = useState<{ uid: string; dx: number; dz: number } | null>(null);
  const grilleRef = useRef<THREE.Mesh>(null);
  const ombreRef = useRef<THREE.Mesh>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => {
    const fin = () => setDrag(null);
    window.addEventListener("pointerup", fin);
    return () => window.removeEventListener("pointerup", fin);
  }, []);

  const demiL = terrasse.largeur / 2;
  const demiP = terrasse.profondeur / 2;
  const textureSol = useTextureSol(sol, mode, terrasse.largeur, terrasse.profondeur);
  const zoomPlan = useMemo(() => Math.max(20, Math.min(120, 520 / Math.max(terrasse.largeur, terrasse.profondeur))), [terrasse]);

  return (
    <Canvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      dpr={[1, 2]}
      onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap; }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: "#26292e" }}
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
      {/* Ombres : la caméra d'ombre est serrée sur la terrasse (+ 2 m de marge
          pour les articles posés à côté) et la carte fait 4096² → ~5 mm par
          texel sur une terrasse de 8 m au lieu de ~12 mm sur ±12 m fixes. */}
      <directionalLight
        position={[demiL + 4, 9, demiP + 3]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-(demiL + 2)}
        shadow-camera-right={demiL + 2}
        shadow-camera-top={demiP + 2}
        shadow-camera-bottom={-(demiP + 2)}
        shadow-camera-near={1}
        shadow-camera-far={30}
        shadow-bias={-0.0002}
        shadow-normalBias={0.01}
        shadow-radius={4}
      />

      {/* Terrasse + quadrillage 50 cm / 1 m */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[terrasse.largeur, terrasse.profondeur]} />
        <meshStandardMaterial
          key={`${sol}-${mode}`}
          color={mode === "maquette" ? "#e8e6e1" : textureSol ? "#ffffff" : (SOLS.find((x) => x.id === sol)?.couleur || "#c9a678")}
          map={textureSol ?? undefined}
          roughness={1}
        />
      </mesh>
      <Grid
        ref={grilleRef}
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
      {/* Récepteur d'ombres, visible seulement pendant le calque « meubles seuls » */}
      <mesh ref={ombreRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.003, 0]} receiveShadow visible={false}>
        <planeGeometry args={[400, 400]} />
        <shadowMaterial transparent opacity={0.45} color="#000000" />
      </mesh>
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
        onPointerDown={() => { if (!dragRef.current) onSelect(null); }}
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
          if (lectureSeule) return;   // le clic passe aux OrbitControls
          e.stopPropagation();
          onSelect(item.uid);
          onDragStart();
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

      <Capture captureRef={captureRef} calqueRef={calqueRef} ambianceRef={ambianceRef} grilleRef={grilleRef} ombreRef={ombreRef} terrasse={terrasse} />
      <Recadrage recadrerRef={recadrerRef} terrasse={terrasse} vue={vue} />
    </Canvas>
  );
}
