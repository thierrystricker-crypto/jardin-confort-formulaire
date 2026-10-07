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
import { MUR_TEXTURES, SOLS, estVegetal, type MurTextureId, type Peinture, type SceneItem, type SolId, type Terrasse, type VueCamera } from "@/lib/planner-types";

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
  // Étirement d'un décor : nouvelle longueur + nouveau centre (l'extrémité
  // opposée à la poignée reste en place).
  onResize?: (uid: string, longueur: number, x: number, z: number) => void;
  onDims: (uid: string, dims: Dims) => void;
  onError: (uid: string, message: string) => void;
  captureRef: React.MutableRefObject<(() => string | null) | null>;
  // Calque « meubles seuls » (fond transparent, sol remplacé par un récepteur
  // d'ombres) pour l'ambiance IA : sert de masque et se recolle sur l'image.
  calqueRef?: React.MutableRefObject<(() => string | null) | null>;
  // Lire / appliquer le point de vue (position, cible, zoom) — mémorisé avec le plan.
  cameraRef?: React.MutableRefObject<{ lire: () => VueCamera | null; appliquer: (c: VueCamera) => void } | null>;
  // Paire capture + calque prise avec la caméra « photo » d'ambiance (hauteur
  // d'œil, bord avant de la terrasse hors champ) — vue 3D seulement.
  ambianceRef?: React.MutableRefObject<(() => { capture: string; calque: string } | null) | null>;
  // Nombre de meubles qui touchent le bord de la dernière capture (l'IA a
  // tendance à les supprimer ou à recadrer) — mis à jour à chaque capture.
  bordsRef?: React.MutableRefObject<number>;
  recadrerRef: React.MutableRefObject<(() => void) | null>;   // « Recadrer » : toute la terrasse dans la vue
  lectureSeule?: boolean;       // page client : on regarde, on tourne, on zoome — on ne touche à rien
};

function rotationY(item: SceneItem): number {
  return ((item.rot + (item.rot_fix || 0)) * Math.PI) / 180;
}

const CLAY = new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.95, metalness: 0 });

// ─── Couleurs appliquées à l'affichage (Fermob, 04.10.2026) ───────────────────
// Une fiche à zones a UNE forme ; la couleur de la variante est posée ici, sur
// des matériaux CLONÉS (deux exemplaires du même article peuvent avoir deux
// couleurs). Les consignes viennent du serveur (lib/modeles-3d-zones.ts).

const TEXTURES = new Map<string, THREE.Texture>();
const TEXTURES_PRETES = new Set<string>();
const TEXTURES_ABONNES = new Map<string, Set<() => void>>();

function chargerTexture(url: string): THREE.Texture {
  let t = TEXTURES.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url, () => {
      TEXTURES_PRETES.add(url);
      for (const f of TEXTURES_ABONNES.get(url) || []) f();
    });
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    TEXTURES.set(url, t);
  }
  return t;
}

// Le chargement est asynchrone : un clone fabriqué avant l'arrivée de l'image
// reste vide. On s'abonne pour lui recoller l'image dès qu'elle est là.
function quandPrete(url: string, f: () => void): () => void {
  if (TEXTURES_PRETES.has(url)) { f(); return () => {}; }
  let abonnes = TEXTURES_ABONNES.get(url);
  if (!abonnes) { abonnes = new Set(); TEXTURES_ABONNES.set(url, abonnes); }
  abonnes.add(f);
  return () => { abonnes!.delete(f); };
}

// Matériaux repeints, indexés par matériau d'origine. Le nom de la matière
// dans le fichier (« zone_structure ») fait le lien avec la consigne.
function construirePeinture(objet: THREE.Object3D, peinture: Peinture[]): Map<THREE.Material, THREE.Material> {
  const out = new Map<THREE.Material, THREE.Material>();
  if (!peinture?.length) return out;
  const parNom = new Map<string, Peinture>();
  for (const p of peinture) for (const n of p.materiaux || []) parNom.set(n, p);
  const rencontres = new Set<string>();
  objet.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // TOUJOURS repartir du matériau d'origine du fichier : au 2e changement de
    // couleur, m.material porte déjà la peinture précédente, et la carte serait
    // alors indexée sur un clone — le meuble reprenait sa couleur de fichier
    // (constaté 04.10.2026 : « une couleur sur deux ne marche pas »).
    const source = (m.userData.materiauOrigine as THREE.Material | THREE.Material[] | undefined) ?? m.material;
    const mats = Array.isArray(source) ? source : [source];
    for (const mat0 of mats) {
      const mat = mat0 as THREE.MeshStandardMaterial;
      if (!mat || out.has(mat)) continue;
      rencontres.add(mat.name);
      const consigne = parNom.get(mat.name);
      if (!consigne) continue;
      const neuf = mat.clone();
      // gltfpack range la déquantification des UV dans la transformation de
      // texture : une texture de remplacement doit reprendre l'échelle de
      // celle d'origine (ou, à défaut, celle de la normal map).
      const ref = mat.map || mat.normalMap || null;
      if (typeof consigne.rugosite === "number") neuf.roughness = consigne.rugosite;
      if (consigne.teinte) {
        if (consigne.couleur) neuf.color.setRGB(consigne.couleur[0], consigne.couleur[1], consigne.couleur[2]);
      } else if (consigne.garder_texture) {
        // on garde la texture du fichier : rien à faire
      } else if (consigne.texture) {
        const t = chargerTexture(consigne.texture).clone();
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.flipY = false;
        if (ref) {
          t.repeat.copy(ref.repeat);
          t.offset.copy(ref.offset);
          t.rotation = ref.rotation;
          t.center.copy(ref.center);
        }
        if (consigne.echelle) t.repeat.set(t.repeat.x * consigne.echelle[0], t.repeat.y * consigne.echelle[1]);
        t.needsUpdate = true;
        neuf.map = t;
        neuf.color.setRGB(1, 1, 1);
      } else if (consigne.couleur) {
        neuf.map = null;
        neuf.color.setRGB(consigne.couleur[0], consigne.couleur[1], consigne.couleur[2]);
      }
      neuf.needsUpdate = true;
      out.set(mat, neuf);
    }
  });
  if (!out.size) {
    // Aucune zone reconnue : le nom des matieres du fichier 3D ne correspond
    // pas aux zones declarees dans le metachamp. Trace pour diagnostic.
    console.warn(
      "[planner] couleur non appliquee : aucune zone reconnue",
      { attendus: [...parNom.keys()], dans_le_fichier: [...rencontres] },
    );
  }
  return out;
}

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

  // Peinture de la variante : recalculée quand la couleur change (sélecteur du
  // panneau de l'article) ou quand le fichier change.
  const clePeinture = JSON.stringify(item.peinture || []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const peints = useMemo(() => construirePeinture(objet, item.peinture || []), [objet, clePeinture]);
  useEffect(() => () => { peints.forEach((m) => m.dispose()); }, [peints]);

  useEffect(() => {
    objet.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const origine = m.userData.materiauOrigine as THREE.Material | THREE.Material[];
      if (mode === "maquette") { m.material = CLAY; return; }
      m.material = Array.isArray(origine)
        ? origine.map((x) => peints.get(x) || x)
        : (peints.get(origine) || origine);
    });
  }, [objet, mode, peints]);

  return (
    <group position={[item.x, 0, item.z]} rotation={[0, rotationY(item), 0]} onPointerDown={onPointerDown} userData={{ meuble: true }}>
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

// ─── Décors : murs et murets étirables ────────────────────────────────────────
// Pas de fichier 3D : une boîte paramétrique habillée d'une texture générée.
// Les deux poignées bleues des extrémités allongent le mur en gardant l'autre
// bout en place, comme sur les planners fabricants (07.10.2026).

const TEX_MUR = new Map<MurTextureId, THREE.CanvasTexture>();

function textureMur(id: MurTextureId): THREE.CanvasTexture | null {
  const deja = TEX_MUR.get(id);
  if (deja) return deja;
  if (typeof document === "undefined") return null;
  const N = 256;                      // 1 tuile = 1 m
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  if (!g) return null;
  const base = MUR_TEXTURES.find((t) => t.id === id)?.couleur || "#dcd7ce";
  g.fillStyle = base;
  g.fillRect(0, 0, N, N);

  if (id === "crepi") {
    for (let i = 0; i < 14000; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},${0.04 + Math.random() * 0.06})`;
      g.fillRect(Math.random() * N, Math.random() * N, 2, 2);
    }
  } else if (id === "pierre") {
    const h = N / 5;                  // assises de 20 cm
    for (let r = 0; r < 5; r++) {
      // La rangée démarre avant 0 et finit après N : les pierres coupées se
      // raccordent d'une tuile à l'autre quand le mur est étiré.
      let x = (r % 2 ? -0.45 : -0.15) * N;
      while (x < N) {
        const w = N * (0.26 + Math.random() * 0.2);
        const t = 18 + Math.random() * 26;
        g.fillStyle = `rgb(${175 + t},${168 + t},${152 + t})`;
        g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        x += w;
      }
    }
    g.strokeStyle = "rgba(0,0,0,0.10)";
    g.lineWidth = 2;
    for (let r = 0; r <= 5; r++) { g.beginPath(); g.moveTo(0, r * h); g.lineTo(N, r * h); g.stroke(); }
  } else if (id === "beton") {
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`;
      g.beginPath();
      g.arc(Math.random() * N, Math.random() * N, Math.random() * 7, 0, Math.PI * 2);
      g.fill();
    }
  } else if (id === "thuya" || id === "laurier" || id === "buis") {
    // Haie taillée : fond sombre puis des milliers de touches de feuillage,
    // plus claires vers le haut de chaque touffe. La taille des touches fait
    // la différence entre une écaille de thuya et une feuille de laurier.
    const reglage = id === "thuya"
      ? { n: 11000, lmin: 3, lmax: 9, larg: 0.42, teinte: [52, 92, 46], ecart: 26 }
      : id === "laurier"
      ? { n: 5200, lmin: 7, lmax: 17, larg: 0.52, teinte: [40, 96, 44], ecart: 34 }
      : { n: 15000, lmin: 2, lmax: 5, larg: 0.78, teinte: [74, 110, 58], ecart: 22 };
    // Le motif est RÉPÉTÉ, jamais étiré (repeat en mètres, voir useMatsMur) :
    // une touche de feuillage qui dépasse d'un bord est donc redessinée sur le
    // bord opposé, sinon le raccord des tuiles se voit sur un mur étiré.
    const boucler = (x: number, y: number, marge: number, dessiner: (x: number, y: number) => void) => {
      for (const dx of [0, -N, N]) {
        for (const dy of [0, -N, N]) {
          if ((dx || dy) && Math.min(x, N - x) > marge && Math.min(y, N - y) > marge) continue;
          dessiner(x + dx, y + dy);
        }
      }
    };
    g.fillStyle = "#1d2d1b";
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < reglage.n; i++) {
      const x = Math.random() * N;
      const y = Math.random() * N;
      const l = reglage.lmin + Math.random() * (reglage.lmax - reglage.lmin);
      const t = (Math.random() - 0.35) * reglage.ecart;
      const [r0, v0, b0] = reglage.teinte;
      const angle = (Math.random() - 0.5) * (id === "thuya" ? 0.7 : Math.PI);
      g.fillStyle = `rgb(${Math.max(0, r0 + t)},${Math.max(0, v0 + t)},${Math.max(0, b0 + t * 0.7)})`;
      boucler(x, y, l + 1, (px, py) => {
        g.save();
        g.translate(px, py);
        g.rotate(angle);
        g.beginPath();
        g.ellipse(0, 0, l * reglage.larg, l, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
    }
    // Quelques trouées sombres : une haie n'est jamais uniforme
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * N, y = Math.random() * N, r = 3 + Math.random() * 11;
      g.fillStyle = `rgba(14,26,13,${0.12 + Math.random() * 0.22})`;
      boucler(x, y, r + 1, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); });
    }
  } else if (id === "bois") {
    const n = 7;                      // lames verticales de ~14 cm
    for (let i = 0; i < n; i++) {
      const t = -16 + Math.random() * 32;
      g.fillStyle = `rgb(${173 + t},${141 + t},${97 + t})`;
      g.fillRect((i * N) / n, 0, N / n - 2, N);
    }
    g.strokeStyle = "rgba(0,0,0,0.16)";
    g.lineWidth = 2;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo((i * N) / n, 0); g.lineTo((i * N) / n, N); g.stroke(); }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  TEX_MUR.set(id, t);
  return t;
}

// Un matériau par face du cube pour que la texture garde son échelle réelle
// (1 tuile = 1 m) quelles que soient les cotes du mur.
// Ordre BoxGeometry : +x, -x, +y, -y, +z, -z.
function useMatsMur(id: MurTextureId, l: number, h: number, e: number, maquette: boolean): THREE.Material[] {
  const def = MUR_TEXTURES.find((t) => t.id === id);
  const fichier = def?.fichier;
  const mats = useMemo(() => {
    if (maquette) return [CLAY, CLAY, CLAY, CLAY, CLAY, CLAY];
    // Texture photo si la matière en a une (/public/textures), sinon motif
    // dessiné. Dans les deux cas 1 tuile = `metres` m : on répète, jamais étirer.
    const base = def?.fichier ? chargerTexture(def.fichier) : textureMur(id);
    const ech = def?.metres || 1;
    const couleur = def?.couleur || "#dcd7ce";
    return ([[e, h], [e, h], [l, e], [l, e], [l, h], [l, h]] as [number, number][]).map(([u0, v0]) => {
      const u = u0 / ech, v = v0 / ech;
      const m = new THREE.MeshStandardMaterial({ color: base ? 0xffffff : new THREE.Color(couleur), roughness: 0.95, metalness: 0 });
      if (base) {
        const t = base.clone();
        t.needsUpdate = true;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(Math.max(0.2, u), Math.max(0.2, v));
        m.map = t;
      }
      return m;
    });
  }, [id, l, h, e, maquette]);
  useEffect(() => {
    if (!fichier || maquette) return;
    return quandPrete(fichier, () => {
      const source = TEXTURES.get(fichier);
      if (!source) return;
      for (const m of mats) {
        const mm = m as THREE.MeshStandardMaterial;
        if (mm.map) { mm.map.image = source.image; mm.map.needsUpdate = true; }
        mm.needsUpdate = true;
      }
    });
  }, [mats, fichier, maquette]);
  useEffect(() => () => {
    if (maquette) return;
    for (const m of mats) { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }
  }, [mats, maquette]);
  return mats;
}

// Silhouette d'une haie taillée : une boîte subdivisée dont les sommets sont
// déplacés par un bruit déterministe (même position de départ = même
// déplacement, donc aucune fissure sur les arêtes). C'est le contour hérissé,
// plus que la matière, qui distingue une vraie haie d'un parallélépipède.
function bruit(x: number, y: number, z: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

function geoHaie(l: number, h: number, e: number): THREE.BufferGeometry {
  const parSegment = 0.12;            // une subdivision tous les 12 cm
  const n = (v: number) => Math.max(2, Math.min(80, Math.round(v / parSegment)));
  const g = new THREE.BoxGeometry(l, h, e, n(l), n(h), n(e));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const ampl = 0.045;                 // ± 4,5 cm de pousse désordonnée
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // rien au ras du sol (la haie reste posée), tout en haut et sur les flancs
    const k = Math.min(1, (y + h / 2) / 0.25);
    const a = ampl * k;
    pos.setXYZ(
      i,
      x + bruit(x, y, z) * a,
      y + bruit(y, z, x) * a * (y > 0 ? 1.6 : 1),
      z + bruit(z, x, y) * a,
    );
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function Decor({ item, mode, selected, lectureSeule, onPointerDown, onEtirer }: {
  item: SceneItem; mode: "couleurs" | "maquette"; selected: boolean; lectureSeule: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onEtirer: (cote: 1 | -1, e: ThreeEvent<PointerEvent>) => void;
}) {
  const d = item.mur!;
  const vegetal = estVegetal(d.texture);
  const mats = useMatsMur(d.texture, d.longueur, d.hauteur, d.epaisseur, mode === "maquette");
  const geo = useMemo(
    () => (vegetal ? geoHaie(d.longueur, d.hauteur, d.epaisseur) : new THREE.BoxGeometry(d.longueur, d.hauteur, d.epaisseur)),
    [vegetal, d.longueur, d.hauteur, d.epaisseur],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group position={[item.x, 0, item.z]} rotation={[0, rotationY(item), 0]} userData={{ meuble: true }}>
      <mesh position={[0, d.hauteur / 2, 0]} castShadow receiveShadow material={mats} geometry={geo} onPointerDown={onPointerDown} />
      {selected && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
            <planeGeometry args={[d.longueur + 0.06, d.epaisseur + 0.06]} />
            <meshBasicMaterial color={0x38bdf8} transparent opacity={0.22} depthWrite={false} />
          </mesh>
          {!lectureSeule && ([1, -1] as const).map((cote) => (
            <mesh
              key={cote}
              position={[(cote * d.longueur) / 2, d.hauteur / 2, 0]}
              onPointerDown={(e) => onEtirer(cote, e)}
            >
              <sphereGeometry args={[Math.min(0.12, Math.max(0.07, d.hauteur / 12)), 14, 10]} />
              <meshBasicMaterial color={0x38bdf8} />
            </mesh>
          ))}
          <Html position={[0, d.hauteur + 0.18, 0]} center style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">
              {Math.round(d.longueur * 100)} × {Math.round(d.epaisseur * 100)} × H {Math.round(d.hauteur * 100)} cm
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

// Meubles dont la boîte englobante sort (ou frôle) le cadre de la caméra.
function meublesAuBord(scene: THREE.Object3D, camera: THREE.Camera): number {
  let n = 0;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.userData?.meuble) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      if (Math.abs(p.x) > 0.96 || Math.abs(p.y) > 0.96) { n++; break; }
    }
  });
  return n;
}

function Capture({ captureRef, calqueRef, ambianceRef, bordsRef, grilleRef, ombreRef, terrasse }: {
  captureRef: Props["captureRef"]; calqueRef?: Props["calqueRef"]; ambianceRef?: Props["ambianceRef"]; bordsRef?: Props["bordsRef"]; grilleRef: RefMesh; ombreRef: RefMesh; terrasse: Terrasse;
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
    // Capture TOUJOURS en 3:2 (1536×1024), quel que soit l'écran : le canvas
    // est rendu hors écran à cette taille avec la même caméra (angle inchangé,
    // champ adapté), puis remis à sa taille. Ainsi la capture de la fiche et
    // le rendu IA (3:2 lui aussi) ont exactement le même cadre.
    captureRef.current = () => {
      const W = 1536, H = 1024;
      const taille = new THREE.Vector2();
      gl.getSize(taille);
      const dpr = gl.getPixelRatio();
      const persp = camera as THREE.PerspectiveCamera;
      const ortho = camera as THREE.OrthographicCamera;
      const sauve = persp.isPerspectiveCamera
        ? { aspect: persp.aspect }
        : { left: ortho.left, right: ortho.right, top: ortho.top, bottom: ortho.bottom };
      gl.setPixelRatio(1);
      gl.setSize(W, H, false);
      if (persp.isPerspectiveCamera) {
        persp.aspect = W / H;
      } else {
        const demiH = (ortho.top - ortho.bottom) / 2;
        ortho.left = -demiH * (W / H);
        ortho.right = demiH * (W / H);
      }
      camera.updateProjectionMatrix();
      if (bordsRef) bordsRef.current = meublesAuBord(scene, camera);
      gl.render(scene, camera);
      const data = gl.domElement.toDataURL("image/png");
      if (persp.isPerspectiveCamera) persp.aspect = (sauve as { aspect: number }).aspect;
      else Object.assign(ortho, sauve);
      camera.updateProjectionMatrix();
      gl.setPixelRatio(dpr);
      gl.setSize(taille.x, taille.y, false);
      gl.render(scene, camera);
      return data;
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
  }, [gl, scene, camera, controls, captureRef, calqueRef, ambianceRef, bordsRef, grilleRef, ombreRef, terrasse]);
  return null;
}

// ─── Point de vue ─────────────────────────────────────────────────────────────
// Expose la caméra courante (et la cible des OrbitControls) pour l'enregistrer
// avec le plan, et la réappliquer à la réouverture.

function PointDeVue({ cameraRef }: { cameraRef?: Props["cameraRef"] }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!cameraRef) return;
    const ctrl = () => controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    cameraRef.current = {
      lire: () => {
        const c = ctrl();
        const r = (v: number) => Math.round(v * 1000) / 1000;
        return {
          pos: camera.position.toArray().map(r) as [number, number, number],
          target: (c ? c.target.toArray() : [0, 0, 0]).map(r) as [number, number, number],
          zoom: (camera as THREE.OrthographicCamera).isOrthographicCamera ? r((camera as THREE.OrthographicCamera).zoom) : undefined,
        };
      },
      appliquer: (v) => {
        const c = ctrl();
        camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
        if (v.zoom && (camera as THREE.OrthographicCamera).isOrthographicCamera) (camera as THREE.OrthographicCamera).zoom = v.zoom;
        camera.updateProjectionMatrix();
        if (c) { c.target.set(v.target[0], v.target[1], v.target[2]); c.update(); }
        else camera.lookAt(v.target[0], v.target[1], v.target[2]);
      },
    };
    return () => { cameraRef.current = null; };
  }, [camera, controls, cameraRef]);
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
  const { items, terrasse, vue, mode, sol, snap, selectedUid, onSelect, onDragStart, onMove, onResize, onDims, onError, captureRef, calqueRef, ambianceRef, bordsRef, cameraRef, recadrerRef, lectureSeule = false } = props;
  const [drag, setDrag] = useState<{ uid: string; dx: number; dz: number } | null>(null);
  const [etire, setEtire] = useState<{ uid: string; cote: 1 | -1 } | null>(null);
  const etireRef = useRef(etire);
  etireRef.current = etire;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const grilleRef = useRef<THREE.Mesh>(null);
  const ombreRef = useRef<THREE.Mesh>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => {
    const fin = () => { setDrag(null); setEtire(null); };
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
        enabled={!drag && !etire}
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
          // Étirement d'un mur : l'extrémité opposée à la poignée reste fixe,
          // on recalcule la longueur et on recentre la boîte sur son axe.
          const et = etireRef.current;
          if (et) {
            const it = itemsRef.current.find((i) => i.uid === et.uid);
            if (!it?.mur || !onResize) return;
            const th = rotationY(it);
            const ax = Math.cos(th), az = -Math.sin(th);
            const L = it.mur.longueur;
            const fx = it.x - (et.cote * L * ax) / 2;
            const fz = it.z - (et.cote * L * az) / 2;
            let nl = ((e.point.x - fx) * ax + (e.point.z - fz) * az) * et.cote;
            nl = Math.max(0.2, arrondir(nl, snap || 0.05));
            onResize(et.uid, +nl.toFixed(3), +(fx + (et.cote * nl * ax) / 2).toFixed(3), +(fz + (et.cote * nl * az) / 2).toFixed(3));
            return;
          }
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
        if (item.mur) {
          return (
            <Decor
              key={item.uid}
              item={item}
              mode={mode}
              selected={item.uid === selectedUid}
              lectureSeule={lectureSeule}
              onPointerDown={debut}
              onEtirer={(cote, e) => {
                if (lectureSeule) return;
                e.stopPropagation();
                onSelect(item.uid);
                onDragStart();
                setEtire({ uid: item.uid, cote });
              }}
            />
          );
        }
        return (
          <Garde key={item.uid} onError={(m) => onError(item.uid, m)} fallback={<ModeleEnErreur item={item} onPointerDown={debut} />}>
            <Suspense fallback={null}>
              <Modele item={item} mode={mode} selected={item.uid === selectedUid} onPointerDown={debut} onDims={(d) => onDims(item.uid, d)} />
            </Suspense>
          </Garde>
        );
      })}

      <Capture captureRef={captureRef} calqueRef={calqueRef} ambianceRef={ambianceRef} bordsRef={bordsRef} grilleRef={grilleRef} ombreRef={ombreRef} terrasse={terrasse} />
      <Recadrage recadrerRef={recadrerRef} terrasse={terrasse} vue={vue} />
      <PointDeVue cameraRef={cameraRef} />
    </Canvas>
  );
}
