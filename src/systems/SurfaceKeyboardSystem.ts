import * as THREE from 'three';
import { XRManager } from '../core/XRManager';
import { NotificationSystem } from './NotificationSystem';
import { audioManager } from '../core/AudioManager';

export interface KeyDef {
  id: string;
  label: string;
  char: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isSpecial?: boolean;
  hasNub?: boolean; // Homing nub for F and J
}

interface TouchRipple {
  mesh: THREE.Mesh;
  active: boolean;
  startTime: number;
  duration: number;
  startScale: number;
  maxScale: number;
}

export class SurfaceKeyboardSystem {
  public group: THREE.Group;
  public mesh: THREE.Mesh;
  public deskHeight = 0.74;

  private xr: XRManager;
  private notificationSys: NotificationSystem;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;

  // Geometry dimensions in meters (realistic 38cm x 12cm laptop keyboard + trackpad)
  public readonly width = 0.38; // 38cm total width
  public readonly depth = 0.12; // 12cm total depth

  // Independent calibration & placement
  public isLocked = false;
  public grabHandleMesh: THREE.Mesh;
  private handleDropLine: THREE.Line;
  private handleRing: THREE.Mesh;

  // Key map
  private keys: KeyDef[] = [];
  private pressedKeyId: string | null = null;

  // Trackpad state
  private isTrackpadTouching = false;
  private trackpadTouchX = 0;
  private trackpadTouchY = 0;
  public onTrackpadTap?: () => void;

  // Press down tracking state machine:
  // Requires lifting finger above ARM threshold (>= 18mm) and pressing down towards desk surface (<= 12mm).
  // Once struck, finger is locked until lifted back above ARM threshold to eliminate multi-typing.
  private fingerState = {
    left: { armed: false, hasStruck: false, peakZ: 0, lastZ: 999, lastPressTime: -1000 },
    right: { armed: false, hasStruck: false, peakZ: 0, lastZ: 999, lastPressTime: -1000 }
  };

  // Trackpad stroke tracking (Top-to-Bottom click gesture)
  private trackpadStroke = {
    left: { isTouching: false, startY: 0, hasClicked: false },
    right: { isTouching: false, startY: 0, hasClicked: false }
  };

  // 3D Hardware-accelerated Key & Trackpad Tap Highlights (0ms canvas lag)
  private keyHighlightMesh!: THREE.Mesh;
  private keyHighlightTimer: number | null = null;
  private trackpadHighlightMesh!: THREE.Mesh;

  // 3D Fingertip Touch Ripple Effect Pool
  private ripplePool: TouchRipple[] = [];
  private readonly POOL_SIZE = 8;

  constructor(
    xr: XRManager,
    notificationSys: NotificationSystem,
    initialDeskPos: THREE.Vector3
  ) {
    this.xr = xr;
    this.notificationSys = notificationSys;
    this.deskHeight = initialDeskPos.y;

    this.group = new THREE.Group();
    // Default independent position in front of user
    this.group.position.set(-0.04, this.deskHeight + 0.003, -0.38);
    this.group.rotation.set(-Math.PI / 2, 0, 0); // Flat on the table surface

    // High-resolution Canvas for holographic projected appearance
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048;
    this.canvas.height = 640;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 1;

    const geo = new THREE.PlaneGeometry(this.width, this.depth);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.userData = { interactive: false, role: 'surface-keyboard' };
    this.group.add(this.mesh);

    // ================= Independent Calibration Grab Handle =================
    // Delicate spherical handle placed in local coordinate space (local Z points up from desk)
    const handleGeo = new THREE.SphereGeometry(0.015, 24, 24);
    const handleMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      roughness: 0.2,
      emissive: 0x0284c7,
      emissiveIntensity: 0.5
    });
    this.grabHandleMesh = new THREE.Mesh(handleGeo, handleMat);
    this.grabHandleMesh.position.set(0, 0, 0.06);
    this.grabHandleMesh.userData = { role: 'keyboard-grab-handle' };
    this.group.add(this.grabHandleMesh);

    // Connecting drop line from handle to keyboard surface
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0.06)
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.008,
      gapSize: 0.006,
      transparent: true,
      opacity: 0.7
    });
    this.handleDropLine = new THREE.Line(lineGeo, lineMat);
    this.handleDropLine.computeLineDistances();
    this.group.add(this.handleDropLine);

    // Base ring around keyboard center
    const ringGeo = new THREE.RingGeometry(0.024, 0.028, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    this.handleRing = new THREE.Mesh(ringGeo, ringMat);
    this.handleRing.position.set(0, 0, 0.001);
    this.group.add(this.handleRing);

    // ================= 3D Fingertip Touch Ripple Effect Pool =================
    this.initRipplePool();

    this.buildKeyMap();
    this.render();

    this.xr.scene.add(this.group);
  }

  private initRipplePool() {
    for (let i = 0; i < this.POOL_SIZE; i++) {
      const rGeo = new THREE.RingGeometry(0.004, 0.008, 32);
      const rMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.set(0, 0, 0.002);
      rMesh.visible = false;
      this.group.add(rMesh);

      this.ripplePool.push({
        mesh: rMesh,
        active: false,
        startTime: 0,
        duration: 0.28,
        startScale: 1.0,
        maxScale: 4.5
      });
    }

    // 3D hardware-accelerated keycap tap highlight (zero 2D canvas re-rendering!)
    const keyHighlightGeo = new THREE.PlaneGeometry(1, 1);
    const keyHighlightMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.keyHighlightMesh = new THREE.Mesh(keyHighlightGeo, keyHighlightMat);
    this.keyHighlightMesh.position.set(0, 0, 0.0015);
    this.keyHighlightMesh.visible = false;
    this.group.add(this.keyHighlightMesh);

    // 3D trackpad touch highlight
    const tpHighlightGeo = new THREE.PlaneGeometry(1, 1);
    const tpHighlightMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.trackpadHighlightMesh = new THREE.Mesh(tpHighlightGeo, tpHighlightMat);
    this.trackpadHighlightMesh.position.set(0, 0, 0.0012);
    this.trackpadHighlightMesh.visible = false;
    this.group.add(this.trackpadHighlightMesh);
  }

  /**
   * Spawn a 3D expanding holographic ripple ring at exact fingertip contact point
   */
  public spawnTouchRipple(localX: number, localY: number) {
    const ripple = this.ripplePool.find((r) => !r.active) || this.ripplePool[0];
    ripple.active = true;
    ripple.startTime = performance.now();
    ripple.mesh.position.set(localX, localY, 0.002);
    ripple.mesh.scale.set(1, 1, 1);
    (ripple.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    ripple.mesh.visible = true;
  }

  public setPosition(pos: THREE.Vector3) {
    this.group.position.copy(pos);
    this.deskHeight = pos.y;
  }

  public setDeskHeight(h: number) {
    this.deskHeight = h;
    this.group.position.y = h + 0.003;
  }

  public setLocked(locked: boolean) {
    this.isLocked = locked;
    this.grabHandleMesh.visible = !locked;
    this.handleDropLine.visible = !locked;
    this.handleRing.visible = !locked;
  }

  /**
   * Build clean, modern keymap matching Meta Surface Keyboard reference photo
   * Spacebar is clean and blank (no ugly 'Space ______' text)
   */
  private buildKeyMap() {
    this.keys = [];

    const kX = 24;
    const kY = 32;
    const rowH = 96;
    const gap = 14;

    // Row 0: Numbers & Symbols (y = 32)
    const r0Keys = [
      { id: '`', label: '`', char: '`', w: 76 },
      { id: '1', label: '1', char: '1', w: 87 },
      { id: '2', label: '2', char: '2', w: 87 },
      { id: '3', label: '3', char: '3', w: 87 },
      { id: '4', label: '4', char: '4', w: 87 },
      { id: '5', label: '5', char: '5', w: 87 },
      { id: '6', label: '6', char: '6', w: 87 },
      { id: '7', label: '7', char: '7', w: 87 },
      { id: '8', label: '8', char: '8', w: 87 },
      { id: '9', label: '9', char: '9', w: 87 },
      { id: '0', label: '0', char: '0', w: 87 },
      { id: '-', label: '-', char: '-', w: 87 },
      { id: '=', label: '=', char: '=', w: 87 },
      { id: 'backspace', label: 'delete', char: 'BACKSPACE', w: 156, isSpecial: true }
    ];
    let curX = kX;
    for (const k of r0Keys) {
      this.keys.push({ id: k.id, label: k.label, char: k.char, x: curX, y: kY, w: k.w, h: rowH, isSpecial: k.isSpecial });
      curX += k.w + gap;
    }

    // Row 1: QWERTY (y = 142)
    const r1Y = kY + rowH + gap;
    const r1Keys = [
      { id: 'tab', label: 'tab', char: '    ', w: 110, isSpecial: true },
      { id: 'q', label: 'q', char: 'q', w: 86 },
      { id: 'w', label: 'w', char: 'w', w: 86 },
      { id: 'e', label: 'e', char: 'e', w: 86 },
      { id: 'r', label: 'r', char: 'r', w: 86 },
      { id: 't', label: 't', char: 't', w: 86 },
      { id: 'y', label: 'y', char: 'y', w: 86 },
      { id: 'u', label: 'u', char: 'u', w: 86 },
      { id: 'i', label: 'i', char: 'i', w: 86 },
      { id: 'o', label: 'o', char: 'o', w: 86 },
      { id: 'p', label: 'p', char: 'p', w: 86 },
      { id: '[', label: '[', char: '[', w: 86 },
      { id: ']', label: ']', char: ']', w: 86 },
      { id: '\\', label: '\\', char: '\\', w: 114 }
    ];
    curX = kX;
    for (const k of r1Keys) {
      this.keys.push({ id: k.id, label: k.label, char: k.char, x: curX, y: r1Y, w: k.w, h: rowH, isSpecial: k.isSpecial });
      curX += k.w + gap;
    }

    // Row 2: ASDF (y = 252)
    const r2Y = r1Y + rowH + gap;
    const r2Keys = [
      { id: 'caps', label: 'caps', char: 'CAPS', w: 130, isSpecial: true },
      { id: 'a', label: 'a', char: 'a', w: 86 },
      { id: 's', label: 's', char: 's', w: 86 },
      { id: 'd', label: 'd', char: 'd', w: 86 },
      { id: 'f', label: 'f', char: 'f', w: 86, hasNub: true },
      { id: 'g', label: 'g', char: 'g', w: 86 },
      { id: 'h', label: 'h', char: 'h', w: 86 },
      { id: 'j', label: 'j', char: 'j', w: 86, hasNub: true },
      { id: 'k', label: 'k', char: 'k', w: 86 },
      { id: 'l', label: 'l', char: 'l', w: 86 },
      { id: ';', label: ';', char: ';', w: 86 },
      { id: "'", label: "'", char: "'", w: 86 },
      { id: 'enter', label: 'return', char: 'ENTER', w: 180, isSpecial: true }
    ];
    curX = kX;
    for (const k of r2Keys) {
      this.keys.push({ id: k.id, label: k.label, char: k.char, x: curX, y: r2Y, w: k.w, h: rowH, isSpecial: k.isSpecial, hasNub: k.hasNub });
      curX += k.w + gap;
    }

    // Row 3: ZXCV (y = 362)
    const r3Y = r2Y + rowH + gap;
    const r3Keys = [
      { id: 'shift_l', label: 'shift', char: 'SHIFT', w: 170, isSpecial: true },
      { id: 'z', label: 'z', char: 'z', w: 86 },
      { id: 'x', label: 'x', char: 'x', w: 86 },
      { id: 'c', label: 'c', char: 'c', w: 86 },
      { id: 'v', label: 'v', char: 'v', w: 86 },
      { id: 'b', label: 'b', char: 'b', w: 86 },
      { id: 'n', label: 'n', char: 'n', w: 86 },
      { id: 'm', label: 'm', char: 'm', w: 86 },
      { id: ',', label: ',', char: ',', w: 86 },
      { id: '.', label: '.', char: '.', w: 86 },
      { id: '/', label: '/', char: '/', w: 86 },
      { id: 'shift_r', label: 'shift', char: 'SHIFT', w: 204, isSpecial: true }
    ];
    curX = kX;
    for (const k of r3Keys) {
      this.keys.push({ id: k.id, label: k.label, char: k.char, x: curX, y: r3Y, w: k.w, h: rowH, isSpecial: k.isSpecial });
      curX += k.w + gap;
    }

    // Row 4: Spacebar & Actions (y = 472)
    // Spacebar is clean and blank per Meta reference (send button removed per user request)
    const r4Y = r3Y + rowH + gap;
    const r4Keys = [
      { id: 'clear', label: 'clear', char: 'CLEAR', w: 160, isSpecial: true },
      { id: 'space', label: '', char: ' ', w: 1096, isSpecial: true } // Blank extended spacebar!
    ];
    curX = kX;
    for (const k of r4Keys) {
      this.keys.push({ id: k.id, label: k.label, char: k.char, x: curX, y: r4Y, w: k.w, h: rowH, isSpecial: k.isSpecial });
      curX += k.w + gap;
    }
  }

  /**
   * Render glowing holographic keyboard and trackpad
   * User request:
   * - Transparent background (Meta prototype style)
   * - No ugly solid key fill on press (3D fingertip ripple handles feedback)
   * - Clean empty trackpad frame
   */
  public render() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Completely clear canvas to keep background 100% transparent
    ctx.clearRect(0, 0, W, H);

    // ================= 1. KEYBOARD KEYS (Left: x = 24 to 1476) =================
    // Thickened crisp stroke lines + subtle glass fill to eliminate fuzziness from distance
    for (const key of this.keys) {
      const isPressed = this.pressedKeyId === key.id;

      // Subtle key body presence so keys aren't faint empty wireframes
      ctx.fillStyle = isPressed ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.roundRect(key.x, key.y, key.w, key.h, 12);
      ctx.fill();

      // Keycap Outline: Thick, solid, high-contrast luminous stroke (visible from distance)
      ctx.strokeStyle = isPressed
        ? '#38bdf8'
        : key.id === 'send'
        ? '#34d399'
        : 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = isPressed ? 7 : 4.5;

      ctx.beginPath();
      ctx.roundRect(key.x, key.y, key.w, key.h, 12);
      ctx.stroke();

      // Keycap Label: Bold, high-contrast typography
      if (key.label) {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = isPressed ? '#38bdf8' : '#ffffff';
        ctx.font = key.isSpecial
          ? 'bold 26px "Plus Jakarta Sans", sans-serif'
          : 'bold 32px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(key.label, key.x + key.w / 2, key.y + key.h / 2);
        ctx.restore();
      }

      // Tactile homing nubs under F and J
      if (key.hasNub) {
        ctx.fillStyle = isPressed ? '#38bdf8' : '#ffffff';
        ctx.fillRect(key.x + key.w / 2 - 16, key.y + key.h / 2 + 22, 32, 5);
      }
    }

    // ================= 2. TRACKPAD SECTION (Right: x = 1500 to 2024) =================
    // Thickened trackpad border with subtle glass fill
    const tpX = 1500;
    const tpY = 32;
    const tpW = 524;
    const tpH = 576;

    ctx.fillStyle = this.isTrackpadTouching ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.roundRect(tpX, tpY, tpW, tpH, 20);
    ctx.fill();

    ctx.strokeStyle = this.isTrackpadTouching ? '#38bdf8' : 'rgba(255, 255, 255, 0.90)';
    ctx.lineWidth = this.isTrackpadTouching ? 8 : 5.5;
    ctx.beginPath();
    ctx.roundRect(tpX, tpY, tpW, tpH, 20);
    ctx.stroke();

    this.texture.needsUpdate = true;
  }

  public handleKeyPress(key: KeyDef, localX?: number, localY?: number) {
    audioManager.playPinchClick();

    // 1. Instant 3D key highlight (zero canvas redraw, zero texture upload, 0ms lag!)
    const kCenterX = ((key.x + key.w / 2) / 2048 - 0.5) * this.width;
    const kCenterY = (0.5 - (key.y + key.h / 2) / 640) * this.depth;
    const kW = (key.w / 2048) * this.width;
    const kH = (key.h / 640) * this.depth;
    this.keyHighlightMesh.position.set(kCenterX, kCenterY, 0.0015);
    this.keyHighlightMesh.scale.set(kW, kH, 1);
    this.keyHighlightMesh.visible = true;
    if (this.keyHighlightTimer !== null) {
      clearTimeout(this.keyHighlightTimer);
    }
    this.keyHighlightTimer = window.setTimeout(() => {
      this.keyHighlightMesh.visible = false;
      this.keyHighlightTimer = null;
    }, 110);

    // 2. Spawn 3D fingertip touch ripple
    if (localX !== undefined && localY !== undefined) {
      this.spawnTouchRipple(localX, localY);
    }

    // User requirement: ONLY type into reply text when reply mode is actually ACTIVE!
    if (!this.notificationSys.isReplyActive()) {
      return;
    }

    // 3. Type into reply text — setting replyText automatically triggers fast single-card redraw!
    if (key.char === 'BACKSPACE') {
      if (this.notificationSys.replyText.length > 0) {
        this.notificationSys.replyText = this.notificationSys.replyText.slice(0, -1);
      }
    } else if (key.char === 'ENTER' || key.char === 'SEND') {
      if (this.notificationSys.replyText.trim().length > 0) {
        this.notificationSys.sendReply();
      }
    } else if (key.char === 'CLEAR') {
      this.notificationSys.replyText = '';
    } else if (key.char === 'SHIFT' || key.char === 'CAPS') {
      // Shift toggle
    } else if (key.char) {
      this.notificationSys.replyText += key.char;
    }
  }

  /**
   * Checks whether a given 3D position (e.g. hand/pinch position)
   * is within the Desk Surface Keyboard & Trackpad proximity zone.
   * When inside this zone, Air Pinch is suppressed to avoid false clicks while typing or resting fingers.
   */
  public isPositionInProximity(
    worldPos: THREE.Vector3,
    marginX = 0.05,
    marginY = 0.05,
    heightLimit = 0.08
  ): boolean {
    const localPos = this.mesh.worldToLocal(worldPos.clone());
    const halfW = this.width / 2 + marginX;
    const halfH = this.depth / 2 + marginY;
    const isInsideHorizontal =
      localPos.x >= -halfW && localPos.x <= halfW &&
      localPos.y >= -halfH && localPos.y <= halfH;
    // local.z is perpendicular to desk (pointing up into user space)
    const isInsideVertical = localPos.z >= -0.04 && localPos.z <= heightLimit;
    return isInsideHorizontal && isInsideVertical;
  }

  /**
   * Hand tracking & physical contact detection
   * User requirement: Must PRESS down onto desk to click, not just hover nearby!
   */
  public update(time: number, frame: XRFrame | null) {
    // 1. Animate active 3D fingertip touch ripples
    for (const r of this.ripplePool) {
      if (!r.active) continue;
      const progress = (performance.now() - r.startTime) / (r.duration * 1000);
      if (progress >= 1.0) {
        r.active = false;
        r.mesh.visible = false;
      } else {
        const currentScale = r.startScale + progress * (r.maxScale - r.startScale);
        r.mesh.scale.set(currentScale, currentScale, 1);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.95;
      }
    }

    if (!frame || !this.xr.xrSession || !this.xr.refSpace) return;

    let anyTrackpadTouch = false;

    for (const inputSource of this.xr.xrSession.inputSources) {
      if (!inputSource.hand) continue;

      const handedness = inputSource.handedness === 'left' ? 'left' : 'right';
      const hand = inputSource.hand;
      const indexTip = hand.get('index-finger-tip');

      if (!indexTip) continue;

      const indexPose = frame.getJointPose ? frame.getJointPose(indexTip, this.xr.refSpace) : null;
      if (!indexPose) continue;

      const fingerWorldPos = new THREE.Vector3(
        indexPose.transform.position.x,
        indexPose.transform.position.y,
        indexPose.transform.position.z
      );

      // Local coordinate space of Surface Keyboard plane
      // local.x: [-W/2, +W/2], local.y: [-H/2, +H/2], local.z: distance perpendicular to desk
      const localPos = this.mesh.worldToLocal(fingerWorldPos.clone());

      const halfW = this.width / 2;
      const halfH = this.depth / 2;
      const isInsideX = localPos.x >= -halfW && localPos.x <= halfW;
      const isInsideY = localPos.y >= -halfH && localPos.y <= halfH;
      const distToSurface = Math.abs(localPos.z);

      const fState = this.fingerState[handedness];

      // 1. Lift-off arming: requires finger to clearly lift above desk (>= 18mm)
      // Once lifted, reset hasStruck and arm for the next stroke
      if (localPos.z >= 0.018) {
        fState.armed = true;
        fState.hasStruck = false;
        fState.peakZ = Math.max(fState.peakZ, localPos.z);
      }

      if (isInsideX && isInsideY && distToSurface < 0.055) {
        const px = ((localPos.x + halfW) / this.width) * 2048;
        const py = ((halfH - localPos.y) / this.depth) * 640;
        const now = performance.now();

        // 2. Deliberate downward strike detection:
        // - Must be armed AND not already struck
        // - Finger reached near-desk contact window: local.z <= 0.012m (12mm) down to -35mm
        // - Natural downward descent: at least 5mm travel from lift peak
        // - 180ms debounce for natural touch typing cadence
        const isDownwardStrike =
          fState.armed &&
          !fState.hasStruck &&
          localPos.z >= -0.035 &&
          localPos.z <= 0.012 &&
          (fState.peakZ - localPos.z >= 0.005) &&
          (now - fState.lastPressTime > 180);

        // A. Keyboard Area Interaction (px < 1490)
        if (px < 1490) {
          const hitKey = this.keys.find(
            (k) => px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h
          );

          if (isDownwardStrike && hitKey) {
            this.handleKeyPress(hitKey, localPos.x, localPos.y);
            // Immediately lock out further strikes until finger lifts back up above 18mm!
            fState.hasStruck = true;
            fState.armed = false;
            fState.peakZ = 0;
            fState.lastPressTime = now;
          }
        }
        // B. Trackpad Area Interaction (px >= 1480)
        else {
          const stroke = this.trackpadStroke[handedness];
          const isTouchingTrackpad = distToSurface <= 0.026; // 26mm — generous for desk variations

          if (isTouchingTrackpad) {
            anyTrackpadTouch = true;
            this.trackpadTouchX = px;
            this.trackpadTouchY = py;

            if (!stroke.isTouching) {
              stroke.isTouching = true;
              stroke.startY = py;
              stroke.hasClicked = false;
            } else {
              const deltaY = py - stroke.startY;

              // Trackpad click triggers by:
              // 1. Deliberate downward tap impact onto trackpad
              // 2. Deliberate downward surface swipe (deltaY >= 35px, ~7mm physical slide)
              const isDownwardSurfaceSwipe = deltaY >= 35;
              const isTapImpact = isDownwardStrike;

              if ((isDownwardSurfaceSwipe || isTapImpact) && !stroke.hasClicked) {
                stroke.hasClicked = true;
                fState.hasStruck = true;
                fState.armed = false;
                fState.peakZ = 0;
                fState.lastPressTime = now;
                this.spawnTouchRipple(localPos.x, localPos.y);
                this.onTrackpadTap?.();
              }
            }
          } else {
            // Finger lifted off trackpad surface
            stroke.isTouching = false;
            stroke.hasClicked = false;
          }
        }
      } else {
        // Finger outside keyboard/trackpad bounds - reset
        this.trackpadStroke[handedness].isTouching = false;
        this.trackpadStroke[handedness].hasClicked = false;
      }

      fState.lastZ = localPos.z;
    }

    if (anyTrackpadTouch !== this.isTrackpadTouching) {
      this.isTrackpadTouching = anyTrackpadTouch;
      if (anyTrackpadTouch) {
        const tpCenterX = ((1500 + 524 / 2) / 2048 - 0.5) * this.width;
        const tpCenterY = (0.5 - (32 + 576 / 2) / 640) * this.depth;
        const tpW = (524 / 2048) * this.width;
        const tpH = (576 / 640) * this.depth;
        this.trackpadHighlightMesh.position.set(tpCenterX, tpCenterY, 0.0012);
        this.trackpadHighlightMesh.scale.set(tpW, tpH, 1);
        this.trackpadHighlightMesh.visible = true;
      } else {
        this.trackpadHighlightMesh.visible = false;
      }
    }
  }
}
