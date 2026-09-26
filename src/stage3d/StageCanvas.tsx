import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { addDuelLights, duelFogScene } from './assets.js';

interface Props {
  readonly build: (scene: THREE.Scene) => THREE.Object3D | void;
  readonly height?: number;
  readonly camera?: readonly [number, number, number];
}

/** Isolated Three.js viewport for Storybook (and local asset checks). */
export function StageCanvas({ build, height = 420, camera = [0, 4.2, 5.4] }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.append(canvas);

    const scene = duelFogScene();
    scene.clear();
    scene.background = new THREE.Color(0x1a0e0a);
    scene.fog = new THREE.FogExp2(0x1a0e0a, 0.028);
    addDuelLights(scene);
    const built = build(scene);
    if (built !== undefined) scene.add(built);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    cam.position.set(camera[0], camera[1], camera[2]);
    const controls = new OrbitControls(cam, canvas);
    controls.target.set(0, 0.2, 0);
    controls.enablePan = false;
    controls.update();

    let frame = 0;
    const fit = (): void => {
      const w = Math.max(120, host.clientWidth);
      const h = Math.max(120, host.clientHeight);
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const tick = (): void => {
      controls.update();
      renderer.render(scene, cam);
      frame = requestAnimationFrame(tick);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [build, camera]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', height, minHeight: 320, background: '#1a0e0a', overflow: 'hidden' }}
    />
  );
}
