import * as THREE from 'three';
import { XRManager } from '../core/XRManager';
import { audioManager } from '../core/AudioManager';

export class AnchorCalibrationSystem {
  public group: THREE.Group;
  public sphereMesh: THREE.Mesh;
  public anchorPosition: THREE.Vector3;
  public isLocked = false;
  public isDragging = false;

  private xr: XRManager;
  private tooltipMesh: THREE.Mesh;
  private dropLine: THREE.Line;
  private baseRing: THREE.Mesh;
  public lockButtonMesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltipTexture: THREE.CanvasTexture;

  public onAnchorUpdated?: (pos: THREE.Vector3) => void;
  public onLockStateChanged?: (isLocked: boolean) => void;

  constructor(xr: XRManager) {
    this.xr = xr;
    this.group = new THREE.Group();

    // Default initial position (slightly to the right-front on desk level)
    this.anchorPosition = new THREE.Vector3(0.38, 0.74, -0.6);
    this.group.position.copy(this.anchorPosition);

    // 1. Draggable translucent sphere (delicate 3.6cm diameter crystal sphere)
    const sphereGeo = new THREE.SphereGeometry(0.018, 28, 28);
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      roughness: 0.15,
      metalness: 0.1,
      transmission: 0.7,
      ior: 1.4,
      emissive: 0x0284c7,
      emissiveIntensity: 0.4
    });
    this.sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    this.sphereMesh.userData = { interactive: false, role: 'anchor-sphere' };
    this.group.add(this.sphereMesh);

    // Inner glowing core
    const coreGeo = new THREE.SphereGeometry(0.007, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.sphereMesh.add(coreMesh);

    // 2. Drop line to desk
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -0.10, 0)
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.01,
      gapSize: 0.008,
      transparent: true,
      opacity: 0.7
    });
    this.dropLine = new THREE.Line(lineGeo, lineMat);
    this.dropLine.computeLineDistances();
    this.group.add(this.dropLine);

    // 3. Desk Base Projection Ring
    const ringGeo = new THREE.RingGeometry(0.026, 0.032, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    this.baseRing = new THREE.Mesh(ringGeo, ringMat);
    this.baseRing.position.y = -0.10;
    this.group.add(this.baseRing);

    // 4. 3D Billboard Tooltip (widened for comfortable breathing room & margins)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 280;
    this.ctx = this.canvas.getContext('2d')!;
    this.tooltipTexture = new THREE.CanvasTexture(this.canvas);
    this.tooltipTexture.minFilter = THREE.LinearFilter;
    this.tooltipTexture.magFilter = THREE.LinearFilter;
    this.renderTooltipCanvas();

    const tooltipGeo = new THREE.PlaneGeometry(0.26, 0.114);
    const tooltipMat = new THREE.MeshBasicMaterial({
      map: this.tooltipTexture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.tooltipMesh = new THREE.Mesh(tooltipGeo, tooltipMat);
    this.tooltipMesh.position.set(0, 0.11, 0); // Positioned comfortably above sphere
    this.tooltipMesh.userData = { interactive: false, role: 'anchor-tooltip' };
    this.group.add(this.tooltipMesh);

    // 5. "Lock" button — frosted glass pill with Lucide lock icon
    const btnW = 0.14;  // 14cm wide
    const btnH = 0.048; // 4.8cm tall
    const btnGeo = new THREE.PlaneGeometry(btnW, btnH);
    const btnCanvas = document.createElement('canvas');
    btnCanvas.width = 512;
    btnCanvas.height = 192;
    const bctx = btnCanvas.getContext('2d')!;

    // Frosted glass background
    bctx.fillStyle = 'rgba(2, 132, 199, 0.18)';
    bctx.beginPath();
    bctx.roundRect(8, 8, 496, 176, 48);
    bctx.fill();

    // Sky-blue border glow
    bctx.strokeStyle = 'rgba(56, 189, 248, 0.80)';
    bctx.lineWidth = 5;
    bctx.stroke();

    // Icon circle badge (left side)
    bctx.fillStyle = 'rgba(2, 132, 199, 0.55)';
    bctx.beginPath();
    bctx.arc(88, 96, 52, 0, Math.PI * 2);
    bctx.fill();
    bctx.strokeStyle = 'rgba(186, 230, 253, 0.6)';
    bctx.lineWidth = 2.5;
    bctx.stroke();

    // Draw Lucide lock icon centered in badge (24×24 @ 2× scale = 48px)
    const lockScale = 48 / 24;
    bctx.save();
    bctx.translate(88 - 24, 96 - 24);
    bctx.scale(lockScale, lockScale);
    bctx.strokeStyle = '#ffffff';
    bctx.lineWidth = 2 / lockScale;
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';
    // Shackle
    bctx.stroke(new Path2D('M7 11V7a5 5 0 0 1 10 0v4'));
    // Body (rounded rect 3,11 → 18×11 r=2)
    bctx.beginPath();
    bctx.moveTo(5, 11); bctx.lineTo(19, 11);
    bctx.quadraticCurveTo(21, 11, 21, 13);
    bctx.lineTo(21, 20); bctx.quadraticCurveTo(21, 22, 19, 22);
    bctx.lineTo(5, 22); bctx.quadraticCurveTo(3, 22, 3, 20);
    bctx.lineTo(3, 13); bctx.quadraticCurveTo(3, 11, 5, 11);
    bctx.closePath();
    bctx.fillStyle = 'rgba(255,255,255,0.15)';
    bctx.fill();
    bctx.stroke();
    bctx.restore();

    // Label text
    bctx.fillStyle = '#f0f9ff';
    bctx.font = 'bold 52px system-ui, sans-serif';
    bctx.textAlign = 'left';
    bctx.textBaseline = 'middle';
    bctx.fillText('Lock Position', 158, 96);

    const btnTex = new THREE.CanvasTexture(btnCanvas);
    btnTex.minFilter = THREE.LinearFilter;
    btnTex.magFilter = THREE.LinearFilter;
    const btnMat = new THREE.MeshBasicMaterial({ map: btnTex, transparent: true, side: THREE.DoubleSide });
    this.lockButtonMesh = new THREE.Mesh(btnGeo, btnMat);
    this.lockButtonMesh.position.set(0.14, 0.01, 0.08);
    this.lockButtonMesh.userData = { interactive: false, role: 'lock-anchor-btn' };
    this.group.add(this.lockButtonMesh);

    this.xr.scene.add(this.group);
  }

  private renderTooltipCanvas() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Frosted glass background card with comfortable margins
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;

    const grad = ctx.createLinearGradient(12, 12, 12, H - 12);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.94)');
    grad.addColorStop(1, 'rgba(30, 41, 59, 0.90)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, H - 24, 22);
    ctx.fill();

    // Crisp luminous border
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Step 1 Pill Badge
    const badgeX = 40;
    const badgeY = 32;
    const badgeW = 92;
    const badgeH = 32;

    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 16);
    ctx.fill();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.60)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STEP 1', badgeX + badgeW / 2, badgeY + badgeH / 2);

    // Title — aligned with badge, generous space on right
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Anchor Above Your Phone', badgeX + badgeW + 16, badgeY + badgeH / 2);

    // Subtle divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(38, 80);
    ctx.lineTo(W - 38, 80);
    ctx.stroke();

    // 3 Instruction Steps — generous indentation & breathing room
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '17px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ctx.fillText('1. Drag sphere directly above your phone.', 42, 114);
    ctx.fillText('2. Pinch "Lock" button to lock position.', 42, 154);
    ctx.fillText('3. Aim with gaze, tap trackpad to interact.', 42, 194);

    this.tooltipTexture.needsUpdate = true;
  }

  public handleSelect(object: THREE.Object3D | null) {
    if (!object) return;

    if (object.userData?.role === 'lock-anchor-btn' && !this.isLocked) {
      audioManager.playNotificationChime();
      this.lockAnchor();
    }
    // Clicking the sphere when locked strictly does NOT unlock it.
    // Unlocking is ONLY permitted by clicking "Recalibrate Phone Anchor" in the simulation menu.
  }

  public lockAnchor() {
    this.isLocked = true;
    this.isDragging = false;
    this.tooltipMesh.visible = false;
    this.lockButtonMesh.visible = false;
    this.dropLine.visible = false;
    this.sphereMesh.userData.interactive = false; // Strictly disable raycast interaction when locked
    this.sphereMesh.visible = false; // Sphere completely disappears when locked!

    // Below ring remains visible on the desk to mark the physical phone anchor point
    this.baseRing.visible = true;
    this.baseRing.scale.set(1.15, 1.15, 1.15);
    (this.baseRing.material as THREE.MeshBasicMaterial).opacity = 0.5;

    this.onAnchorUpdated?.(this.anchorPosition);
    this.onLockStateChanged?.(true);
  }

  public unlockAnchor() {
    this.isLocked = false;
    this.isDragging = false;
    this.tooltipMesh.visible = true;
    this.lockButtonMesh.visible = true;
    this.dropLine.visible = true;
    this.sphereMesh.visible = true; // Sphere reappears during recalibration
    this.sphereMesh.userData.interactive = true; // Re-enable interaction

    (this.sphereMesh.material as THREE.MeshPhysicalMaterial).opacity = 0.6;
    this.baseRing.visible = true;
    this.baseRing.scale.set(1, 1, 1);
    (this.baseRing.material as THREE.MeshBasicMaterial).opacity = 0.6;
    this.onLockStateChanged?.(false);
  }

  public setGrabbedState(isGrabbed: boolean) {
    if (this.isLocked) return;

    const mat = this.sphereMesh.material as THREE.MeshPhysicalMaterial;
    if (isGrabbed) {
      this.sphereMesh.scale.set(1.25, 1.25, 1.25);
      mat.color.setHex(0x60a5fa);
      mat.emissive.setHex(0x38bdf8);
      mat.emissiveIntensity = 0.95;
    } else {
      this.sphereMesh.scale.set(1, 1, 1);
      mat.color.setHex(0x38bdf8);
      mat.emissive.setHex(0x0284c7);
      mat.emissiveIntensity = 0.4;
    }
  }

  public update(time: number) {
    // Gentle floating breathing animation if unlocked
    if (!this.isLocked) {
      this.sphereMesh.position.y = Math.sin(time * 3) * 0.008;
    } else {
      this.sphereMesh.position.y = 0;
    }

    // Billboards face actual XR camera position
    const camPos = this.xr.getCameraPosition();
    this.tooltipMesh.lookAt(camPos);
    this.lockButtonMesh.lookAt(camPos);
  }

  public setPosition(pos: THREE.Vector3) {
    this.anchorPosition.copy(pos);
    this.group.position.copy(pos);
    this.onAnchorUpdated?.(this.anchorPosition);
  }
}
