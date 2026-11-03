import * as THREE from '../lib/three/three.module.js';
import { MstsRouteScene } from './mstsRouteScene.js?v=20261103-scoring-catenary-1';

export class SpeedRegulationScene extends MstsRouteScene {
  constructor(canvas, scenario) {
    super(canvas, { profile: 'speed-regulation', routeWindow: scenario.routeWindow });
    this.speedScenario = scenario;
    this.startOffset = scenario.startOffset;
    this.speedSignals = [];
  }

  async load() {
    await super.load();
    this.startOffset = this.speedScenario.startOffset;
    this.buildSpeedSignals();
    this.applyCamera();
  }

  setScenario(scenario) {
    this.speedScenario = scenario;
    this.startOffset = scenario.startOffset;
    if (!this.ready) return;
    for (const signal of this.speedSignals) {
      signal.root.removeFromParent();
      signal.root.traverse((object) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          if (material.map && material.map !== this.signalGlowTexture) material.map.dispose?.();
          if (!object.userData.sharedSignalMaterial) material.dispose?.();
        }
      });
    }
    this.speedSignals = [];
    this.buildSpeedSignals();
    this.applyCamera();
  }

  getPathCurve(distance = this.distance, sampleDistance = 24) {
    if (!this.ready || !this.pathLength) return 0;
    const routeDistance = this.startOffset + Math.max(0, Number(distance) || 0);
    const before = this.getPathPosition(Math.max(0, routeDistance - sampleDistance), new THREE.Vector3());
    const center = this.getPathPosition(Math.min(this.pathLength, routeDistance), new THREE.Vector3());
    const after = this.getPathPosition(Math.min(this.pathLength, routeDistance + sampleDistance), new THREE.Vector3());
    const incoming = center.clone().sub(before); incoming.y = 0;
    const outgoing = after.clone().sub(center); outgoing.y = 0;
    if (incoming.lengthSq() < .0001 || outgoing.lengthSq() < .0001) return 0;
    incoming.normalize(); outgoing.normalize();
    const cross = incoming.x * outgoing.z - incoming.z * outgoing.x;
    const dot = Math.max(-1, Math.min(1, incoming.dot(outgoing)));
    return Math.atan2(cross, dot) / Math.max(1, sampleDistance);
  }

  buildSpeedSignals() {
    const glowMap = this.createSignalGlowTexture();
    for (const config of this.speedScenario.signals) {
      const root = new THREE.Group();
      root.name = `SPEED_TRAINING_SIGNAL_${config.id}`;
      const throughSignal = config.id.endsWith('through');
      const sourceBody = throughSignal
        ? this.createSourceShapeObject(this.repairAssetData, 'tongguo.s', `SOURCE_TONGGUO_${config.id}`)
        : config.id === 'entry'
          ? this.createSourceShapeObject(this.sourceSceneData, 'jinzhan.s', 'SOURCE_JINZHAN_ENTRY')
          : null;
      if (sourceBody) {
        sourceBody.traverse((object) => { if (object.isMesh) object.userData.sharedSignalMaterial = true; });
        root.add(sourceBody);
      } else {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(.11, .14, 6.2, 10),
          new THREE.MeshStandardMaterial({ color: '#d8d8d1', roughness: .72 }),
        );
        pole.position.y = 3.1;
        root.add(pole);
        const head = new THREE.Mesh(
          new THREE.BoxGeometry(.88, 2.55, .55),
          new THREE.MeshStandardMaterial({ color: '#151b1c', roughness: .58 }),
        );
        head.position.set(0, 6.65, 0);
        root.add(head);
      }
      const lamps = [];
      const lampDefinitions = throughSignal
        ? [['green', 5.548], ['red', 5.255], ['yellow', 4.963]]
        : [['yellowTop', 5.86], ['green', 5.34], ['red', 4.83], ['yellowBottom', 4.31]];
      for (const [slot, y] of lampDefinitions) {
        const lamp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowMap,
          color: '#26302b',
          transparent: true,
          opacity: .25,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }));
        lamp.userData.slot = slot;
        lamp.position.set(0, y, -.08);
        lamp.scale.set(.72, .72, 1);
        root.add(lamp);
        lamps.push(lamp);
      }
      this.placeLookoutObject3D(root, this.speedScenario.startOffset + config.distance, 3.6, 0);
      this.routeRoot.add(root);
      const signal = { root, lamps, config };
      this.setAspect(signal, config.aspect);
      this.speedSignals.push(signal);
    }
  }

  setAspect(signal, aspect) {
    const activeSlots = {
      green: new Set(['green']),
      'green-yellow': new Set(['green', 'yellow']),
      yellow: new Set(['yellow', 'yellowTop']),
      'double-yellow': new Set(['yellowTop', 'yellowBottom']),
      red: new Set(['red']),
    }[aspect] || new Set(['green']);
    signal.lamps.forEach((lamp) => {
      const active = activeSlots.has(lamp.userData.slot);
      const color = lamp.userData.slot.startsWith('yellow') || lamp.userData.slot === 'yellow' ? '#ffd640'
        : lamp.userData.slot === 'red' ? '#ff302a' : '#1cff65';
      lamp.material.color.set(active ? color : '#26302b');
      lamp.material.opacity = active ? 1 : .18;
    });
  }

  update(distance, speed, view = this.view) {
    super.update(distance, speed, view, true, 1);
    for (const signal of this.speedSignals) {
      const remaining = signal.config.distance - distance;
      signal.root.visible = remaining > -130 && remaining < 2400;
    }
  }
}
