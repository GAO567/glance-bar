import * as THREE from 'three';
import { XRManager } from '../core/XRManager';
import { NotificationSystem } from '../systems/NotificationSystem';
import { audioManager } from '../core/AudioManager';
import { drawIcon, ICONS, IconDef } from '../core/Icons';

export type MenuHoverItem = 'minimize' | 'sms' | 'call' | 'auto' | 'reposition' | null;

export class SimulationMenu {
  public group: THREE.Group;
  public expandedMesh: THREE.Mesh;
  public minimizedMesh: THREE.Mesh;
  public panelMesh: THREE.Mesh; // Alias for backward compatibility
  public handleSphere: THREE.Mesh; // Grab handle for spatial drag

  private xr: XRManager;
  private notificationSys: NotificationSystem;

  // Dedicated canvases and textures for Expanded vs Minimized to avoid texture allocation bugs
  private expCanvas: HTMLCanvasElement;
  private expCtx: CanvasRenderingContext2D;
  private expTexture: THREE.CanvasTexture;

  private minCanvas: HTMLCanvasElement;
  private minCtx: CanvasRenderingContext2D;
  private minTexture: THREE.CanvasTexture;

  public onReposition?: () => void;
  public isAutoMode = false;
  public isMinimized = false;

  // Gaze auto-selection state (no cursor dot needed!)
  public hoveredItem: MenuHoverItem = null;
  public isLookingAtMinimized = false;
  private menuRaycaster = new THREE.Raycaster();
  private lastActionTime = -1000;

  // Expanded canvas logical dimensions (drawn at 2× for crisp retina resolution)
  private readonly CW = 640;
  private readonly CH = 500;

  // Hit zone Y ranges (in logical canvas coords) when expanded
  private readonly HIT = {
    sms:        { y0: 82,  y1: 174 },
    call:       { y0: 182, y1: 274 },
    auto:       { y0: 282, y1: 374 },
    divider:    { y0: 374, y1: 420 },
    reposition: { y0: 420, y1: 490 },
  };

  constructor(xr: XRManager, notificationSys: NotificationSystem) {
    this.xr = xr;
    this.notificationSys = notificationSys;

    this.group = new THREE.Group();
    this.group.position.set(-0.65, 1.08, -0.75);
    this.group.rotation.set(0, 0.45, 0);
    this.group.renderOrder = 5;

    const maxAniso = Math.max(1, this.xr.renderer.capabilities.getMaxAnisotropy());

    // ── 1. Expanded Menu Surface (Light Gray Frosted Glass) ──
    this.expCanvas = document.createElement('canvas');
    this.expCanvas.width = this.CW * 2;
    this.expCanvas.height = this.CH * 2;
    this.expCtx = this.expCanvas.getContext('2d')!;
    this.expCtx.scale(2, 2);

    this.expTexture = new THREE.CanvasTexture(this.expCanvas);
    this.expTexture.colorSpace = THREE.SRGBColorSpace;
    this.expTexture.generateMipmaps = false;
    this.expTexture.minFilter = THREE.LinearFilter;
    this.expTexture.magFilter = THREE.LinearFilter;
    this.expTexture.anisotropy = 1;

    const expGeo = new THREE.PlaneGeometry(0.36, 0.281);
    const expMat = new THREE.MeshBasicMaterial({
      map: this.expTexture,
      transparent: true,
      side: THREE.DoubleSide
    });

    this.expandedMesh = new THREE.Mesh(expGeo, expMat);
    this.expandedMesh.renderOrder = 5;
    this.expandedMesh.userData = { interactive: true, role: 'simulation-menu' };
    this.panelMesh = this.expandedMesh; // Compatibility
    this.group.add(this.expandedMesh);

    // ── 2. Dedicated Minimized Icon (Pure floating menu icon badge, 46mm circle) ──
    this.minCanvas = document.createElement('canvas');
    this.minCanvas.width = 256;
    this.minCanvas.height = 256;
    this.minCtx = this.minCanvas.getContext('2d')!;
    this.minCtx.scale(2, 2);

    this.minTexture = new THREE.CanvasTexture(this.minCanvas);
    this.minTexture.colorSpace = THREE.SRGBColorSpace;
    this.minTexture.generateMipmaps = false;
    this.minTexture.minFilter = THREE.LinearFilter;
    this.minTexture.magFilter = THREE.LinearFilter;
    this.minTexture.anisotropy = 1;

    const minGeo = new THREE.PlaneGeometry(0.046, 0.046);
    const minMat = new THREE.MeshBasicMaterial({
      map: this.minTexture,
      transparent: true,
      side: THREE.DoubleSide
    });

    this.minimizedMesh = new THREE.Mesh(minGeo, minMat);
    this.minimizedMesh.renderOrder = 5;
    this.minimizedMesh.userData = { interactive: true, role: 'simulation-menu' };
    this.minimizedMesh.visible = false;
    this.group.add(this.minimizedMesh);

    // ── 3. Drag Handle Sphere (top-left corner, visible only when expanded) ──
    const sphereGeo = new THREE.SphereGeometry(0.014, 20, 20);
    const sphereMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      roughness: 0.2,
      metalness: 0.1,
      transmission: 0.6,
      ior: 1.4,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
    });
    this.handleSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.handleSphere.position.set(-0.20, 0.155, 0.015);
    this.handleSphere.userData = { interactive: false, role: 'menu-handle' };
    this.group.add(this.handleSphere);

    // Tiny bright core inside the sphere
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 10), coreMat);
    this.handleSphere.add(coreMesh);

    this.group.visible = false;
    this.xr.scene.add(this.group);

    this.renderMenu();
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
    if (visible) this.renderMenu();
  }

  public triggerSMS()  { this.notificationSys.triggerRandomSMS(); }
  public triggerCall() { this.notificationSys.triggerRandomCall(); }

  public toggleAutoMode() {
    this.isAutoMode = !this.isAutoMode;
    if (this.isAutoMode) this.notificationSys.startAutoMode();
    else                  this.notificationSys.stopAutoMode();
    this.renderExpandedMenu();
  }

  public syncAutoState(active: boolean) {
    if (this.isAutoMode !== active) {
      this.isAutoMode = active;
      this.renderExpandedMenu();
    }
  }

  /**
   * Collapse menu into clean floating menu icon badge
   */
  public minimize() {
    this.isMinimized = true;
    audioManager.playPinchClick();

    this.expandedMesh.visible = false;
    this.handleSphere.visible = false;
    this.minimizedMesh.visible = true;

    this.renderMinimizedMenu();
  }

  /**
   * Expand back to full simulation menu
   */
  public maximize() {
    this.isMinimized = false;
    audioManager.playPinchClick();

    this.minimizedMesh.visible = false;
    this.expandedMesh.visible = true;
    this.handleSphere.visible = true;

    this.renderExpandedMenu();
  }

  public toggleMinimize() {
    if (this.isMinimized) this.maximize();
    else this.minimize();
  }

  /**
   * Head-gaze auto selection update per frame:
   * Buttons highlight automatically based on line-of-sight without requiring an on-screen cursor!
   */
  public update(_time: number) {
    if (!this.group.visible) return;

    const camPos = this.xr.getCameraPosition();
    const gazeDir = this.xr.getGazeDirection().normalize();
    const gazeRay = new THREE.Ray(camPos, gazeDir);

    // 1. Minimized mode: check gaze distance to the circular icon
    if (this.isMinimized) {
      const minPos = this.minimizedMesh.getWorldPosition(new THREE.Vector3());
      const dist = gazeRay.distanceToPoint(minPos);
      const isHovered = dist < 0.085;

      if (isHovered !== this.isLookingAtMinimized) {
        this.isLookingAtMinimized = isHovered;
        this.renderMinimizedMenu();
      }

      const targetScale = isHovered ? 1.15 : 1.0;
      this.minimizedMesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), 0.18);
      return;
    }

    // 2. Expanded mode: raycast onto expanded menu plane to determine which button is hovered
    this.menuRaycaster.set(camPos, gazeDir);
    const hits = this.menuRaycaster.intersectObject(this.expandedMesh);

    let nextHovered: MenuHoverItem = null;
    if (hits.length > 0 && hits[0].uv) {
      const uv = hits[0].uv;
      const px = uv.x * this.CW;
      const py = (1 - uv.y) * this.CH;
      const H = this.HIT;

      // Minimize (-) button in top-right
      if (px >= 500 && px <= 620 && py >= 10 && py <= 75) {
        nextHovered = 'minimize';
      } else if (py >= H.sms.y0 && py <= H.sms.y1 && px >= 35 && px <= 605) {
        nextHovered = 'sms';
      } else if (py >= H.call.y0 && py <= H.call.y1 && px >= 35 && px <= 605) {
        nextHovered = 'call';
      } else if (py >= H.auto.y0 && py <= H.auto.y1 && px >= 35 && px <= 605) {
        nextHovered = 'auto';
      } else if (py >= H.reposition.y0 && py <= H.reposition.y1 && px >= 35 && px <= 605) {
        nextHovered = 'reposition';
      }
    }

    if (nextHovered !== this.hoveredItem) {
      this.hoveredItem = nextHovered;
      this.renderExpandedMenu();
    }
  }

  /**
   * Check whether user's gaze is currently focused on any interactive menu element
   */
  public isGazeHovered(): boolean {
    return this.isMinimized ? this.isLookingAtMinimized : this.hoveredItem !== null;
  }

  /**
   * Execute action for whichever button is currently hovered by head gaze on right-hand pinch
   */
  public handleGazePinch(): boolean {
    if (!this.group.visible) return false;

    const now = performance.now();
    if (now - this.lastActionTime < 280) return false;

    if (this.isMinimized) {
      if (this.isLookingAtMinimized) {
        this.lastActionTime = now;
        this.maximize();
        return true;
      }
      return false;
    }

    if (!this.hoveredItem) return false;

    this.lastActionTime = now;
    audioManager.playPinchClick();

    switch (this.hoveredItem) {
      case 'minimize':
        this.minimize();
        return true;
      case 'sms':
        this.triggerSMS();
        return true;
      case 'call':
        this.triggerCall();
        return true;
      case 'auto':
        this.toggleAutoMode();
        return true;
      case 'reposition':
        this.onReposition?.();
        return true;
    }
    return false;
  }

  /**
   * Backward compatibility for ray intersection selection (e.g. desktop mouse click)
   */
  public handleSelect(intersection: THREE.Intersection | null) {
    if (!this.group.visible) return;

    const now = performance.now();
    if (now - this.lastActionTime < 280) return;

    if (this.isMinimized) {
      if (intersection?.object === this.minimizedMesh || this.isLookingAtMinimized) {
        this.lastActionTime = now;
        this.maximize();
      }
      return;
    }

    if (intersection && intersection.uv) {
      const px = intersection.uv.x * this.CW;
      const py = (1 - intersection.uv.y) * this.CH;
      const H = this.HIT;

      this.lastActionTime = now;
      audioManager.playPinchClick();

      if (px >= 500 && px <= 620 && py >= 10 && py <= 75) {
        this.minimize();
      } else if (py >= H.sms.y0 && py <= H.sms.y1 && px >= 35 && px <= 605) {
        this.triggerSMS();
      } else if (py >= H.call.y0 && py <= H.call.y1 && px >= 35 && px <= 605) {
        this.triggerCall();
      } else if (py >= H.auto.y0 && py <= H.auto.y1 && px >= 35 && px <= 605) {
        this.toggleAutoMode();
      } else if (py >= H.reposition.y0 && py <= H.reposition.y1 && px >= 35 && px <= 605) {
        this.onReposition?.();
      }
      return;
    }

    this.handleGazePinch();
  }

  public renderMenu() {
    if (this.isMinimized) {
      this.renderMinimizedMenu();
    } else {
      this.renderExpandedMenu();
    }
  }

  /**
   * Render minimized state: clean floating circular badge showing ONLY the menu icon
   */
  private renderMinimizedMenu() {
    const ctx = this.minCtx;
    const size = 128; // Logical size (2x supersampled to 256)
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const r = 52;
    const isHovered = this.isLookingAtMinimized;

    ctx.save();
    if (isHovered) {
      // Radiant cyan halo on gaze hover
      ctx.shadowColor = 'rgba(56, 189, 248, 0.85)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(240, 249, 255, 0.98)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    } else {
      // Elegant frosted light-gray circular chip
      ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 2;

      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(1, 'rgba(241, 245, 249, 0.92)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.90)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    ctx.restore();

    // Subtle inner accent ring
    ctx.strokeStyle = isHovered ? 'rgba(56, 189, 248, 0.40)' : 'rgba(255, 255, 255, 0.60)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
    ctx.stroke();

    // Centered Lucide Menu Icon (3 clean horizontal bars)
    const iconColor = isHovered ? '#0284c7' : '#1e293b';
    drawIcon(ctx, ICONS['menu'], cx, cy, 32, iconColor, 2.6);

    this.minTexture.needsUpdate = true;
  }

  /**
   * Render full expanded simulation menu in Light Gray Theme with Gaze Hover Highlights
   */
  private renderExpandedMenu() {
    const ctx = this.expCtx;
    const W = this.CW;
    const H = this.CH;

    ctx.clearRect(0, 0, W, H);

    // ── 1. Frosted Light-Gray Glass Background Panel ──
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 3;

    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, 'rgba(248, 250, 252, 0.96)');
    bgGrad.addColorStop(1, 'rgba(241, 245, 249, 0.93)');
    ctx.fillStyle = bgGrad;
    this._rr(ctx, 8, 8, W - 16, H - 16, 20);
    ctx.fill();

    ctx.strokeStyle = 'rgba(203, 213, 225, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // ── 2. Header Section Label: SIMULATION ──
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SIMULATION', 40, 44);

    // ── 3. Top-Right Corner Minimize Button (-) with Gaze Hover Glow ──
    const minBtnX = W - 54;
    const minBtnY = 44;
    const minBtnR = 17;
    const isMinHovered = this.hoveredItem === 'minimize';

    ctx.save();
    if (isMinHovered) {
      ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(224, 242, 254, 0.95)';
      ctx.beginPath();
      ctx.arc(minBtnX, minBtnY, minBtnR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.80)';
      ctx.beginPath();
      ctx.arc(minBtnX, minBtnY, minBtnR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();

    const minIconColor = isMinHovered ? '#0284c7' : '#334155';
    drawIcon(ctx, ICONS['minus'], minBtnX, minBtnY, 16, minIconColor, 2.4);

    // Divider under header
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.90)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 64); ctx.lineTo(W - 40, 64); ctx.stroke();

    // ── 4. Action Cards (with dynamic gaze-hover glow and outline!) ──
    this._btn(
      ctx,
      this.HIT.sms.y0,
      ICONS['message-circle'],
      'Incoming Message',
      'SMS notification',
      '#0284c7',
      '#0369a1',
      this.hoveredItem === 'sms'
    );

    this._btn(
      ctx,
      this.HIT.call.y0,
      ICONS['phone'],
      'Incoming Call',
      'Voice call',
      '#059669',
      '#047857',
      this.hoveredItem === 'call'
    );

    if (this.isAutoMode) {
      this._btn(
        ctx,
        this.HIT.auto.y0,
        ICONS['pause'],
        'Auto Mode',
        'Running • ~10s interval',
        '#d97706',
        '#b45309',
        this.hoveredItem === 'auto'
      );
      // Live amber pulse dot
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.arc(W - 50, this.HIT.auto.y0 + 46, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      this._btn(
        ctx,
        this.HIT.auto.y0,
        ICONS['play'],
        'Auto Mode',
        'Random simulation (~10s)',
        '#4f46e5',
        '#4338ca',
        this.hoveredItem === 'auto'
      );
    }

    // ── 5. Divider with CONTROLS Label ──
    const divY = this.HIT.divider.y0 + 6;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.90)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, divY); ctx.lineTo(W - 40, divY); ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('CONTROLS', 40, divY + 16);

    // ── 6. Reposition Row with Gaze Hover Highlight ──
    this._repositionRow(ctx, this.HIT.reposition.y0 + 6, this.hoveredItem === 'reposition');

    this.expTexture.needsUpdate = true;
  }

  /** Modern light card action button with gaze-hover state */
  private _btn(
    ctx: CanvasRenderingContext2D,
    y: number,
    icon: IconDef,
    label: string,
    sublabel: string,
    iconColorA: string,
    iconColorB: string,
    isHovered: boolean
  ) {
    const W = this.CW;
    const bH = 84;
    const bX = 40;
    const bW = W - 80;

    // Card background with glowing hover feedback
    ctx.save();
    if (isHovered) {
      ctx.shadowColor = 'rgba(56, 189, 248, 0.40)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = 'rgba(240, 249, 255, 0.98)';
      this._rr(ctx, bX, y, bW, bH, 14);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.04)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 1;

      ctx.fillStyle = '#ffffff';
      this._rr(ctx, bX, y, bW, bH, 14);
      ctx.fill();

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();

    // Vibrant Icon Circle Badge
    const iconGrad = ctx.createLinearGradient(bX + 20, y + 20, bX + 64, y + 64);
    iconGrad.addColorStop(0, iconColorA);
    iconGrad.addColorStop(1, iconColorB);
    ctx.fillStyle = iconGrad;
    ctx.beginPath(); ctx.arc(bX + 42, y + bH / 2, 22, 0, Math.PI * 2); ctx.fill();

    drawIcon(ctx, icon, bX + 42, y + bH / 2, 20, '#ffffff', 2.2);

    // Typography
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHovered ? '#0284c7' : '#0f172a';
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.fillText(label, bX + 78, y + 28);

    ctx.fillStyle = '#64748b';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(sublabel, bX + 78, y + 54);

    // Chevron on the right
    const chevronColor = isHovered ? '#0284c7' : '#94a3b8';
    drawIcon(ctx, ICONS['chevron-right'], W - 52, y + bH / 2, 16, chevronColor, 2.2);
  }

  /** Compact reposition row with gaze hover highlight */
  private _repositionRow(ctx: CanvasRenderingContext2D, y: number, isHovered: boolean) {
    const W = this.CW;
    const bH = 52;
    const bX = 40;
    const bW = W - 80;

    ctx.save();
    if (isHovered) {
      ctx.fillStyle = 'rgba(240, 249, 255, 0.95)';
      this._rr(ctx, bX, y, bW, bH, 12);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      this._rr(ctx, bX, y, bW, bH, 12);
      ctx.fill();

      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    const pinColor = isHovered ? '#0284c7' : '#64748b';
    drawIcon(ctx, ICONS['map-pin'], bX + 26, y + bH / 2, 16, pinColor, 2);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHovered ? '#0369a1' : '#334155';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('Reposition', bX + 50, y + bH / 2);

    ctx.fillStyle = '#64748b';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Unlock anchor to recalibrate', W - 50, y + bH / 2);
  }

  private _rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
