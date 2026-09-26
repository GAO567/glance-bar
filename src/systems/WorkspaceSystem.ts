import * as THREE from 'three';
import { XRManager } from '../core/XRManager';
import { audioManager } from '../core/AudioManager';
import { drawIcon, ICONS } from '../core/Icons';

export type WorkspaceDocType = 'ppt' | 'word';

export interface WorkspaceWindow {
  type: WorkspaceDocType;
  title: string;
  group: THREE.Group;
  slideMesh: THREE.Mesh;
  slideMaterial: THREE.MeshBasicMaterial;
  aspectRatio: number;
  width: number;
  height: number;
  targetPos: THREE.Vector3;
  targetRotY: number;
  targetScale: number;
  targetOpacity: number;
  currentScale: number;
  currentOpacity: number;
}

export class WorkspaceSystem {
  public group: THREE.Group;
  public screenCenter: THREE.Vector3;

  private xr: XRManager;
  public activeDoc: WorkspaceDocType = 'ppt';
  public isLookingAtSwitchIcon = false;

  public pptWindow!: WorkspaceWindow;
  public wordWindow!: WorkspaceWindow;

  // Single corner switch button (Only on front window, icon only, no text)
  public switchButtonMesh!: THREE.Mesh;
  private switchCanvas!: HTMLCanvasElement;
  private switchCtx!: CanvasRenderingContext2D;
  private switchTexture!: THREE.CanvasTexture;
  private readonly BUTTON_CANVAS_SIZE = 256;
  private readonly BUTTON_3D_SIZE = 0.046; // 46mm diameter

  constructor(xr: XRManager) {
    this.xr = xr;
    this.group = new THREE.Group();
    this.group.renderOrder = 1;
    this.screenCenter = new THREE.Vector3(0, 1.15, -1.15);

    // 1. Initialize PPT Window (Border removed)
    this.pptWindow = this.createWindow(
      'ppt',
      'PowerPoint Presentation',
      '/assets/presentation_slide.png',
      1020 / 638
    );

    // 2. Initialize Word / Document Window (Border removed, cropped to 1024x641)
    this.wordWindow = this.createWindow(
      'word',
      'Word Document',
      '/assets/word_document.png',
      1024 / 641
    );

    this.group.add(this.pptWindow.group);
    this.group.add(this.wordWindow.group);

    // 3. Initialize Single Icon-only Switch Button
    this.initSwitchButton();

    this.xr.scene.add(this.group);

    // Initialize initial slot positions (PPT front, Word back-diagonal)
    this.updateTargetTransforms(true);
    this.renderSwitchButton();
  }

  private createWindow(
    type: WorkspaceDocType,
    title: string,
    imageSrc: string,
    initialAspect: number
  ): WorkspaceWindow {
    const winGroup = new THREE.Group();

    const width = 0.85;
    const height = width / initialAspect;

    // Slide Texture & Mesh (Clean borderless surface)
    const slideGeo = new THREE.PlaneGeometry(width, height);
    const slideMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1.0,
      depthWrite: true,
      depthTest: true
    });

    const slideMesh = new THREE.Mesh(slideGeo, slideMaterial);
    slideMesh.userData = { interactive: false, role: `workspace-${type}` };
    winGroup.add(slideMesh);

    const win: WorkspaceWindow = {
      type,
      title,
      group: winGroup,
      slideMesh,
      slideMaterial,
      aspectRatio: initialAspect,
      width,
      height,
      targetPos: new THREE.Vector3(),
      targetRotY: 0,
      targetScale: 1.0,
      targetOpacity: 1.0,
      currentScale: 1.0,
      currentOpacity: 1.0
    };

    // Load High-fidelity Texture with Anisotropic Filtering
    const loader = new THREE.TextureLoader();
    loader.load(imageSrc, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const maxAniso = this.xr.renderer.capabilities.getMaxAnisotropy();
      texture.anisotropy = Math.max(1, maxAniso);
      texture.needsUpdate = true;

      slideMaterial.map = texture;
      slideMaterial.needsUpdate = true;

      if (texture.image && texture.image.width && texture.image.height) {
        const aspect = texture.image.width / texture.image.height;
        win.aspectRatio = aspect;
        const newH = width / aspect;
        win.height = newH;

        slideMesh.geometry.dispose();
        slideMesh.geometry = new THREE.PlaneGeometry(width, newH);

        // Reposition switch button if this window is currently front
        if (this.activeDoc === win.type && this.switchButtonMesh) {
          this.positionSwitchButton(win);
        }
      }
    });

    return win;
  }

  /**
   * Initialize the single top-right corner switch button (icon-only, no text)
   */
  private initSwitchButton() {
    this.switchCanvas = document.createElement('canvas');
    this.switchCanvas.width = this.BUTTON_CANVAS_SIZE;
    this.switchCanvas.height = this.BUTTON_CANVAS_SIZE;
    this.switchCtx = this.switchCanvas.getContext('2d')!;
    this.switchCtx.scale(2, 2); // 2x supersampling for crisp high-DPI rendering

    this.switchTexture = new THREE.CanvasTexture(this.switchCanvas);
    this.switchTexture.minFilter = THREE.LinearFilter;
    this.switchTexture.magFilter = THREE.LinearFilter;

    const btnGeo = new THREE.PlaneGeometry(this.BUTTON_3D_SIZE, this.BUTTON_3D_SIZE);
    const btnMat = new THREE.MeshBasicMaterial({
      map: this.switchTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true
    });

    this.switchButtonMesh = new THREE.Mesh(btnGeo, btnMat);
    this.switchButtonMesh.renderOrder = 3;
    this.switchButtonMesh.userData = { interactive: false, role: 'workspace-switch-button' };

    // Dock onto the active front window
    const frontWin = this.activeDoc === 'ppt' ? this.pptWindow : this.wordWindow;
    frontWin.group.add(this.switchButtonMesh);
    this.positionSwitchButton(frontWin);
  }

  private positionSwitchButton(win: WorkspaceWindow) {
    // Dock OUTSIDE the screenshot at the top-right corner
    // win.width / 2 is the right edge, win.height / 2 is the top edge
    this.switchButtonMesh.position.set(
      win.width / 2 + 0.026,
      win.height / 2 + 0.026,
      0.008
    );
  }

  /**
   * Update target transforms for Front and Back slots
   * Back slot only peeks out a subtle edge with tighter depth gap
   */
  private updateTargetTransforms(snapImmediate = false) {
    const y = this.screenCenter.y;
    const isPptFront = this.activeDoc === 'ppt';

    // Front active slot: centered at screenCenter
    const frontPos = new THREE.Vector3(0, y, -1.15);
    const frontRotY = 0;
    const frontScale = 1.0;
    const frontOpacity = 1.0;

    // Back slot: only peeking out an edge to the right (+0.075m) with small gap (-1.21m vs -1.15m)
    const backPos = new THREE.Vector3(0.075, y + 0.012, -1.21);
    const backRotY = -0.04;
    const backScale = 0.985;
    const backOpacity = 0.92;

    const frontWin = isPptFront ? this.pptWindow : this.wordWindow;
    const backWin = isPptFront ? this.wordWindow : this.pptWindow;

    frontWin.targetPos.copy(frontPos);
    frontWin.targetRotY = frontRotY;
    frontWin.targetScale = frontScale;
    frontWin.targetOpacity = frontOpacity;
    frontWin.group.renderOrder = 2;
    frontWin.slideMesh.renderOrder = 2;

    backWin.targetPos.copy(backPos);
    backWin.targetRotY = backRotY;
    backWin.targetScale = backScale;
    backWin.targetOpacity = backOpacity;
    backWin.group.renderOrder = 1;
    backWin.slideMesh.renderOrder = 1;

    if (snapImmediate) {
      frontWin.group.position.copy(frontPos);
      frontWin.group.rotation.y = frontRotY;
      frontWin.group.scale.set(frontScale, frontScale, frontScale);
      frontWin.currentScale = frontScale;
      frontWin.currentOpacity = frontOpacity;
      frontWin.slideMaterial.opacity = frontOpacity;

      backWin.group.position.copy(backPos);
      backWin.group.rotation.y = backRotY;
      backWin.group.scale.set(backScale, backScale, backScale);
      backWin.currentScale = backScale;
      backWin.currentOpacity = backOpacity;
      backWin.slideMaterial.opacity = backOpacity;
    }
  }

  /**
   * Swap positions of PPT and Word windows with smooth spatial transition
   */
  public swapWindows() {
    this.activeDoc = this.activeDoc === 'ppt' ? 'word' : 'ppt';
    audioManager.playPinchClick();

    // Attach the single switch button to the new front window
    const frontWin = this.activeDoc === 'ppt' ? this.pptWindow : this.wordWindow;
    frontWin.group.add(this.switchButtonMesh);
    this.positionSwitchButton(frontWin);

    this.updateTargetTransforms();
    this.renderSwitchButton();
  }

  /**
   * Render single top-right corner switch button (Only icon, no text)
   */
  public renderSwitchButton() {
    if (!this.switchCtx) return;

    const ctx = this.switchCtx;
    const size = 128; // Logical canvas coordinates (2x scaled to 256)
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const r = 52;
    const isHovered = this.isLookingAtSwitchIcon;

    ctx.save();
    if (isHovered) {
      // Radiant cyan halo on gaze hover
      ctx.shadowColor = 'rgba(56, 189, 248, 0.95)';
      ctx.shadowBlur = 18;
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(14, 165, 233, 0.50)');
      grad.addColorStop(1, 'rgba(2, 132, 199, 0.40)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    } else {
      // Crisp frosted glass circular panel
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 10;
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(15, 23, 42, 0.90)');
      grad.addColorStop(1, 'rgba(30, 41, 59, 0.82)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2.0;
      ctx.stroke();
    }
    ctx.restore();

    // Subtle inner accent ring
    ctx.strokeStyle = isHovered ? 'rgba(255, 255, 255, 0.40)' : 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, 0, Math.PI * 2);
    ctx.stroke();

    // Centered Switch Icon: Lucide arrow-left-right (Clean icon ONLY, no text)
    const iconColor = isHovered ? '#ffffff' : '#f1f5f9';
    drawIcon(ctx, ICONS['arrow-left-right'], cx, cy, 32, iconColor, 2.6);

    this.switchTexture.needsUpdate = true;
  }

  public setCenterHeight(y: number) {
    this.screenCenter.y = y;
    this.updateTargetTransforms();
  }

  public setPosition(pos: THREE.Vector3) {
    this.screenCenter.copy(pos);
    this.updateTargetTransforms();
  }

  public redrawSlide() {
    // Retained for backward compatibility
  }

  public update(_time: number) {
    // 1. Smooth Spatial Transition Animation between Front and Back Slots
    const lerpPos = 0.12;
    const lerpRot = 0.12;
    const lerpScale = 0.12;
    const lerpOpacity = 0.14;

    for (const win of [this.pptWindow, this.wordWindow]) {
      win.group.position.lerp(win.targetPos, lerpPos);
      win.group.rotation.y += (win.targetRotY - win.group.rotation.y) * lerpRot;

      win.currentScale += (win.targetScale - win.currentScale) * lerpScale;
      win.group.scale.set(win.currentScale, win.currentScale, win.currentScale);

      win.currentOpacity += (win.targetOpacity - win.currentOpacity) * lerpOpacity;
      win.slideMaterial.opacity = win.currentOpacity;
    }

    // Hover scale animation for the single switch button
    if (this.switchButtonMesh) {
      const targetBtnScale = this.isLookingAtSwitchIcon ? 1.14 : 1.0;
      this.switchButtonMesh.scale.lerp(new THREE.Vector3(targetBtnScale, targetBtnScale, 1), 0.18);
    }

    // 2. Head Gaze Intersection on the single corner switch button (direct gaze only)
    const camPos = this.xr.getCameraPosition();
    const gazeDir = this.xr.getGazeDirection().normalize();
    const gazeRay = new THREE.Ray(camPos, gazeDir);

    if (this.switchButtonMesh) {
      const buttonPos = this.switchButtonMesh.getWorldPosition(new THREE.Vector3());
      const distToButton = gazeRay.distanceToPoint(buttonPos);

      // Precise direct gaze to the top-right corner button only (~5.5cm radius, ~2.7° visual cone)
      // Requires turning head deliberately ~21° right and ~11° up to look at the icon badge.
      // Eliminates accidental triggering while reading the right side of the PPT.
      const isHovering = distToButton < 0.055;

      if (isHovering !== this.isLookingAtSwitchIcon) {
        this.isLookingAtSwitchIcon = isHovering;
        this.renderSwitchButton();
      }
    }
  }
}
