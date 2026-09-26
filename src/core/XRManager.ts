import * as THREE from 'three';
import { audioManager } from './AudioManager';

export type InteractionMode = 'mr' | 'vr' | 'desktop';

export interface PinchEvent {
  hand: 'left' | 'right';
  position: THREE.Vector3;
}

export class XRManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public mode: InteractionMode = 'desktop';

  // Controllers & Hands
  public controller1: THREE.XRTargetRaySpace | null = null;
  public controller2: THREE.XRTargetRaySpace | null = null;
  public controllerGrip1: THREE.XRGripSpace | null = null;
  public controllerGrip2: THREE.XRGripSpace | null = null;
  public hand1: THREE.XRHandSpace | null = null;
  public hand2: THREE.XRHandSpace | null = null;

  // Raycasting
  public raycaster: THREE.Raycaster;
  public mouse: THREE.Vector2;

  // Event callbacks
  public onPinchStart?: (e: PinchEvent) => void;
  public onPinchMove?: (e: PinchEvent) => void;
  public onPinchEnd?: (e: PinchEvent) => void;
  public onSelect?: (intersection: THREE.Intersection | null) => void;
  public onSessionRecenter?: () => void;
  public onSessionEnd?: () => void;

  // Spatial Surface Cursor / Reticle
  public reticleMesh!: THREE.Mesh;
  public hoverIntersection: THREE.Intersection | null = null;

  // State tracking
  private isRightPinching = false;
  private isLeftPinching = false;
  private lastPinchStartTime = -1000;
  private readonly PINCH_ENTER_DIST = 0.018; // 1.8 cm: deliberate finger contact
  private readonly PINCH_EXIT_DIST = 0.028;  // 2.8 cm: hysteresis release threshold
  private readonly PINCH_DEBOUNCE_MS = 280;  // 280ms debounce window to prevent multi-triggers
  public xrSession: XRSession | null = null;
  public refSpace: XRReferenceSpace | null = null;

  // Desktop camera orbit simulation
  private isMouseDown = false;
  private prevMousePos = { x: 0, y: 0 };
  private cameraRotation = { yaw: 0, pitch: 0 };

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent for MR passthrough!

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
    this.camera.position.set(0, 1.25, 0.4); // Standard seated eye level

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;

    // Enable 1.5x supersampling on Quest / WebXR to eliminate blur and render at native display panel resolution
    this.renderer.xr.setFramebufferScaleFactor(1.5);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.setupLighting();
    this.setupDesktopControls();
    this.setupResize();
    this.setupXRControllers();
    this.setupReticle();
  }

  private setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(2, 4, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

    const pointLight = new THREE.PointLight(0x60a5fa, 0.8, 5);
    pointLight.position.set(-1, 2, 0);
    this.scene.add(pointLight);
  }

  private setupXRControllers() {
    // Controller 1 (Right by default or source 0)
    this.controller1 = this.renderer.xr.getController(0);
    this.controller1.addEventListener('selectstart', () => this.handleXRSelectStart(this.controller1!));
    this.controller1.addEventListener('selectend', () => this.handleXRSelectEnd(this.controller1!));
    this.controller1.addEventListener('select', () => this.handleXRControllerSelect(this.controller1!, 'right'));
    this.scene.add(this.controller1);

    // Controller 2 (Left by default or source 1)
    this.controller2 = this.renderer.xr.getController(1);
    this.controller2.addEventListener('selectstart', () => this.handleXRSelectStart(this.controller2!));
    this.controller2.addEventListener('selectend', () => this.handleXRSelectEnd(this.controller2!));
    this.controller2.addEventListener('select', () => this.handleXRControllerSelect(this.controller2!, 'left'));
    this.scene.add(this.controller2);

    // Hand tracking controllers (Visible ray lines removed per user request for clean immersion)
    this.hand1 = this.renderer.xr.getHand(0);
    this.hand2 = this.renderer.xr.getHand(1);
    this.scene.add(this.hand1);
    this.scene.add(this.hand2);
  }

  private activeSelectController: THREE.XRTargetRaySpace | null = null;

  private handleXRControllerSelect(_controller: THREE.XRTargetRaySpace, _hand: 'left' | 'right') {
    // Pinch gesture removed per user requirement: all interactions unified to Gaze + Desk Trackpad Tap
  }

  private handleXRSelectStart(_controller: THREE.XRTargetRaySpace) {
    // Pinch gesture removed per user requirement
  }

  private handleXRSelectEnd(_controller: THREE.XRTargetRaySpace) {
    // Pinch gesture removed per user requirement
  }

  public updateControllers() {
    // Pinch gesture removed per user requirement
  }

  /**
   * Set up spatial projection reticle / cursor dot
   */
  private hollowTex!: THREE.CanvasTexture;
  private solidTex!: THREE.CanvasTexture;
  private reticleMat!: THREE.MeshBasicMaterial;
  private currentReticleScale = 1.0;
  private lastClickTimestamp = 0;

  /**
   * Initialize dynamic spatial reticle with Hollow-to-Solid & Scaling click feedback
   */
  private setupReticle() {
    // 1. Idle / Hover texture: Crisp Hollow Ring (transparent center)
    const hCanvas = document.createElement('canvas');
    hCanvas.width = 128;
    hCanvas.height = 128;
    const hctx = hCanvas.getContext('2d')!;

    // Outer glowing cyan border
    hctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    hctx.lineWidth = 10;
    hctx.beginPath();
    hctx.arc(64, 64, 46, 0, Math.PI * 2);
    hctx.stroke();

    // Inner bright halo ring
    hctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    hctx.lineWidth = 3;
    hctx.beginPath();
    hctx.arc(64, 64, 38, 0, Math.PI * 2);
    hctx.stroke();

    // Subtle center pinpoint dot (hollow aperture remains clear)
    hctx.fillStyle = '#ffffff';
    hctx.beginPath();
    hctx.arc(64, 64, 4, 0, Math.PI * 2);
    hctx.fill();

    this.hollowTex = new THREE.CanvasTexture(hCanvas);

    // 2. Clicked / Pinched texture: Brilliant Solid Filled Circle
    const sCanvas = document.createElement('canvas');
    sCanvas.width = 128;
    sCanvas.height = 128;
    const sctx = sCanvas.getContext('2d')!;

    // Outer glow bloom
    sctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
    sctx.beginPath();
    sctx.arc(64, 64, 60, 0, Math.PI * 2);
    sctx.fill();

    // Solid cyan ring
    sctx.fillStyle = '#38bdf8';
    sctx.beginPath();
    sctx.arc(64, 64, 48, 0, Math.PI * 2);
    sctx.fill();

    // Solid bright white center
    sctx.fillStyle = '#ffffff';
    sctx.beginPath();
    sctx.arc(64, 64, 36, 0, Math.PI * 2);
    sctx.fill();

    this.solidTex = new THREE.CanvasTexture(sCanvas);

    const reticleGeo = new THREE.PlaneGeometry(0.026, 0.026); // 2.6cm cursor
    this.reticleMat = new THREE.MeshBasicMaterial({
      map: this.hollowTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.reticleMesh = new THREE.Mesh(reticleGeo, this.reticleMat);
    this.reticleMesh.renderOrder = 9999;
    this.reticleMesh.visible = false;
    this.scene.add(this.reticleMesh);
  }

  /**
   * Trigger explicit click feedback animation
   */
  public triggerClickFeedback() {
    this.lastClickTimestamp = performance.now();
    audioManager.playPinchClick();
  }

  /**
   * Reticle cursor completely disabled:
   * Gaze selection is handled via element hover states and pinch/touchpad click
   * without cluttering the visual field with an artificial crosshair.
   */
  public updateReticle() {
    if (this.reticleMesh) {
      this.reticleMesh.visible = false;
    }
  }

  private setupDesktopControls() {
    window.addEventListener('mousedown', (e) => {
      if (this.mode !== 'desktop') return;
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return;

      this.isMouseDown = true;
      this.triggerClickFeedback();
      this.prevMousePos = { x: e.clientX, y: e.clientY };

      // Raycast click
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);

      const intersects = this.raycaster.intersectObjects(this.scene.children, true);
      const target = intersects.find((hit) => hit.object.visible && hit.object.userData?.interactive);
      if (target) {
        this.onSelect?.(target);
      } else {
        this.onSelect?.(null);
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      if (this.mode !== 'desktop' || !this.isMouseDown) return;

      const deltaX = e.clientX - this.prevMousePos.x;
      const deltaY = e.clientY - this.prevMousePos.y;
      this.prevMousePos = { x: e.clientX, y: e.clientY };

      // Orbit camera slightly to simulate looking around in headset
      if (e.buttons === 2 || e.shiftKey) {
        this.cameraRotation.yaw -= deltaX * 0.003;
        this.cameraRotation.pitch = Math.max(-1.1, Math.min(1.1, this.cameraRotation.pitch - deltaY * 0.003));

        const euler = new THREE.Euler(this.cameraRotation.pitch, this.cameraRotation.yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(euler);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

  }

  private setupResize() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /**
   * Request WebXR Immersive AR (Passthrough MR) Session
   */
  public async startMRSession(): Promise<boolean> {
    if (!navigator.xr) {
      console.warn('WebXR not supported in this browser. Falling back to desktop mode.');
      return false;
    }

    try {
      const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
      const sessionMode: XRSessionMode = isArSupported ? 'immersive-ar' : 'immersive-vr';

      const sessionInit: XRSessionInit = {
        requiredFeatures: ['local-floor'],
        optionalFeatures: [
          'hand-tracking',
          'hit-test',
          'layers'
        ]
      };

      const session = await navigator.xr.requestSession(sessionMode, sessionInit);
      this.xrSession = session;
      this.mode = isArSupported ? 'mr' : 'vr';

      await this.renderer.xr.setSession(session);
      this.refSpace = await session.requestReferenceSpace('local-floor');

      // Listen for Meta Quest Recenter (holding Meta button resets reference space)
      this.refSpace.addEventListener('reset', () => {
        this.onSessionRecenter?.();
      });

      // Listen for WebXR session select events
      session.addEventListener('select', (event: XRInputSourceEvent) => {
        this.handleXRInputSelect(event);
      });

      session.addEventListener('end', () => {
        this.xrSession = null;
        this.mode = 'desktop';
        this.onSessionEnd?.();
      });

      return true;
    } catch (err) {
      console.error('Failed to start WebXR session:', err);
      return false;
    }
  }

  private handleXRInputSelect(_event: XRInputSourceEvent) {
    const now = performance.now();
    // Suppress WebXR synthetic select event if a hand pinch was already recognized recently
    if (now - this.lastPinchStartTime < 400) return;

    if (this.hoverIntersection && this.hoverIntersection.object.userData?.role === 'simulation-menu') {
      this.triggerClickFeedback();
      this.onSelect?.(this.hoverIntersection);
    }
  }

  /**
   * Hand tracking joints update for direct 3D proximity pinch manipulation.
   * Uses dual-threshold Schmitt trigger hysteresis and temporal debounce to eliminate multi-trigger jitter.
   */
  public updateHands(frame: XRFrame | null) {
    if (!frame || !this.xrSession || !this.refSpace) return;

    for (const inputSource of this.xrSession.inputSources) {
      if (!inputSource.hand) continue;

      // STRICT: Right-hand pinch only! Left-hand pinch is completely disabled per user requirement.
      if (inputSource.handedness !== 'right') continue;

      const hand = inputSource.hand;
      const indexTip = hand.get('index-finger-tip');
      const thumbTip = hand.get('thumb-tip');

      if (indexTip && thumbTip) {
        const indexPose = frame.getJointPose ? frame.getJointPose(indexTip, this.refSpace) : null;
        const thumbPose = frame.getJointPose ? frame.getJointPose(thumbTip, this.refSpace) : null;

        if (indexPose && thumbPose) {
          const idxPos = new THREE.Vector3(
            indexPose.transform.position.x,
            indexPose.transform.position.y,
            indexPose.transform.position.z
          );
          const thmPos = new THREE.Vector3(
            thumbPose.transform.position.x,
            thumbPose.transform.position.y,
            thumbPose.transform.position.z
          );

          const distance = idxPos.distanceTo(thmPos);
          const pinchPos = idxPos.clone().lerp(thmPos, 0.5);
          const now = performance.now();

          if (!this.isRightPinching) {
            // Hysteresis enter: requires < 1.8cm AND >= 280ms since last pinch
            if (distance < this.PINCH_ENTER_DIST && (now - this.lastPinchStartTime >= this.PINCH_DEBOUNCE_MS)) {
              this.isRightPinching = true;
              this.lastPinchStartTime = now;

              // Authoritative single-event dispatch
              this.onPinchStart?.({
                hand: 'right',
                position: pinchPos
              });
            }
          } else {
            // Already pinching
            if (distance > this.PINCH_EXIT_DIST) {
              // Hysteresis release: fingers must clearly separate beyond 2.8cm
              this.isRightPinching = false;

              this.onPinchEnd?.({
                hand: 'right',
                position: pinchPos
              });
            } else {
              // Continuous hold: send position update
              this.onPinchMove?.({
                hand: 'right',
                position: pinchPos
              });
            }
          }
        }
      }
    }
  }

  public getActiveCamera(): THREE.Camera {
    return this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
  }

  public getGazeDirection(target = new THREE.Vector3()): THREE.Vector3 {
    this.getActiveCamera().getWorldDirection(target);
    return target;
  }

  public getCameraPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.getActiveCamera().getWorldPosition(target);
    return target;
  }
}
