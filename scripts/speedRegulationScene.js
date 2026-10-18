import * as THREE from '../lib/three/three.module.js';
import { MstsRouteScene } from './mstsRouteScene.js';

const ASPECT_COLORS = Object.freeze({
  green: ['#1cff65'],
  'green-yellow': ['#1cff65', '#ffd640'],
  'double-yellow': ['#ffd640', '#ffd640'],
  yellow: ['#ffd640'],
  red: ['#ff302a'],
});

export class SpeedRegulationScene extends MstsRouteScene {
  constructor(canvas, scenario) {
    super(canvas, { profile: 'power-training' });
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

  buildSpeedSignals() {
    const glowMap = this.createSignalGlowTexture();
    for (const config of this.speedScenario.signals) {
      const root = new THREE.Group();
      root.name = `SPEED_TRAINING_SIGNAL_${config.id}`;
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
      const lamps = [];
      for (let index = 0; index < 3; index += 1) {
        const lamp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowMap,
          color: '#26302b',
          transparent: true,
          opacity: .25,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }));
        lamp.position.set(0, 7.4 - index * .74, -.34);
        lamp.scale.set(.72, .72, 1);
        root.add(lamp);
        lamps.push(lamp);
      }
      const plate = this.makeLabel(config.label);
      plate.position.set(0, 5.15, 0);
      root.add(plate);
      this.placeLookoutObject3D(root, this.speedScenario.startOffset + config.distance, 3.6, 0);
      this.routeRoot.add(root);
      const signal = { root, lamps, config };
      this.setAspect(signal, config.aspect);
      this.speedSignals.push(signal);
    }
  }

  makeLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(4,20,28,.88)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#8fe8ff';
    context.lineWidth = 4;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = '#fff';
    context.font = 'bold 30px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.scale.set(5.7, 1.42, 1);
    return sprite;
  }

  setAspect(signal, aspect) {
    const colors = ASPECT_COLORS[aspect] || ASPECT_COLORS.green;
    signal.lamps.forEach((lamp, index) => {
      const color = colors[index];
      lamp.material.color.set(color || '#26302b');
      lamp.material.opacity = color ? 1 : .2;
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
