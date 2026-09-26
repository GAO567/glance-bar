import * as THREE from 'three';
import { XRManager } from '../core/XRManager';

export type GazeFocusState = 'PERIPHERAL' | 'DIRECT_GAZE' | 'AWAY';

export interface GazeStatus {
  angleDegrees: number;
  state: GazeFocusState;
  isLookingAtPhone: boolean;
  isLookingAtPPT: boolean;
}

export class PeripheralGazeSystem {
  private xr: XRManager;
  public phoneAnchor: THREE.Vector3;
  public pptAnchor: THREE.Vector3;

  public currentAngle = 45;
  public focusState: GazeFocusState = 'PERIPHERAL';
  public isLookingAtPhone = false;
  public isLookingAtPPT = true;

  // Angles in degrees
  private directGazeThreshold = 24; // User looking at phone
  private peripheralThreshold = 34; // User returned to looking at PPT

  // Visualizer cone
  public visualizerGroup: THREE.Group;
  private gazeRayLine: THREE.Line;
  private coneMesh: THREE.Mesh;
  public showVisualizer = false;

  public onGazeEnterPhone?: () => void;
  public onGazeLeavePhone?: () => void;

  constructor(xr: XRManager, initialPhonePos: THREE.Vector3, pptPos: THREE.Vector3) {
    this.xr = xr;
    this.phoneAnchor = initialPhonePos.clone();
    this.pptAnchor = pptPos.clone();

    this.visualizerGroup = new THREE.Group();
    this.visualizerGroup.visible = false;

    // Gaze ray line
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -2)
    ]);
    const rayMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 });
    this.gazeRayLine = new THREE.Line(rayGeo, rayMat);
    this.visualizerGroup.add(this.gazeRayLine);

    // Peripheral FOV cone
    const coneGeo = new THREE.ConeGeometry(0.35, 1.2, 32, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, -0.6);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    this.coneMesh = new THREE.Mesh(coneGeo, coneMat);
    this.visualizerGroup.add(this.coneMesh);

    this.xr.scene.add(this.visualizerGroup);
  }

  public updatePhoneAnchor(pos: THREE.Vector3) {
    this.phoneAnchor.copy(pos);
  }

  public toggleVisualizer(visible?: boolean) {
    this.showVisualizer = visible !== undefined ? visible : !this.showVisualizer;
    this.visualizerGroup.visible = this.showVisualizer;
  }

  public update(): GazeStatus {
    const camPos = this.xr.getCameraPosition();
    const gazeDir = this.xr.getGazeDirection().normalize();

    // Direction vector to phone anchor & vertical bubble stack column
    const toPhone = new THREE.Vector3().subVectors(this.phoneAnchor, camPos).normalize();
    const dotPhone = Math.max(-1, Math.min(1, gazeDir.dot(toPhone)));
    let minStackAngle = Math.acos(dotPhone) * (180 / Math.PI);

    // Test against the vertical bubble stack column (from desk anchor up to +0.85m above)
    // so looking at higher bubbles (bubbles 3–7) correctly counts as looking at notifications!
    const stackBottom = new THREE.Vector3(this.phoneAnchor.x, this.phoneAnchor.y - 0.10, this.phoneAnchor.z);
    const stackTop = new THREE.Vector3(this.phoneAnchor.x, this.phoneAnchor.y + 0.85, this.phoneAnchor.z);
    for (let step = 1; step <= 8; step++) {
      const p = stackBottom.clone().lerp(stackTop, step / 8);
      const toP = p.sub(camPos).normalize();
      const dotP = Math.max(-1, Math.min(1, gazeDir.dot(toP)));
      const angleP = Math.acos(dotP) * (180 / Math.PI);
      if (angleP < minStackAngle) minStackAngle = angleP;
    }
    this.currentAngle = minStackAngle;

    // Direction vector to PPT center
    const toPPT = new THREE.Vector3().subVectors(this.pptAnchor, camPos).normalize();
    const dotPPT = Math.max(-1, Math.min(1, gazeDir.dot(toPPT)));
    const anglePPT = Math.acos(dotPPT) * (180 / Math.PI);
    this.isLookingAtPPT = anglePPT < 28;

    // Hysteresis state machine
    const prevPhoneFocus = this.isLookingAtPhone;

    if (this.currentAngle < this.directGazeThreshold) {
      this.isLookingAtPhone = true;
      this.focusState = 'DIRECT_GAZE';
    } else if (this.currentAngle > this.peripheralThreshold) {
      this.isLookingAtPhone = false;
      this.focusState = 'PERIPHERAL';
    }

    // Trigger state change events
    if (this.isLookingAtPhone && !prevPhoneFocus) {
      this.onGazeEnterPhone?.();
    } else if (!this.isLookingAtPhone && prevPhoneFocus) {
      this.onGazeLeavePhone?.();
    }

    // Update visualizer transform
    if (this.showVisualizer) {
      this.visualizerGroup.position.copy(camPos);
      this.visualizerGroup.quaternion.copy(this.xr.camera.quaternion);
    }

    return {
      angleDegrees: Math.round(this.currentAngle),
      state: this.focusState,
      isLookingAtPhone: this.isLookingAtPhone,
      isLookingAtPPT: this.isLookingAtPPT
    };
  }
}
