import * as THREE from 'three';
import { XRManager } from '../core/XRManager';
import { audioManager } from '../core/AudioManager';
import { drawIcon, ICONS } from '../core/Icons';

export type NotificationType = 'sms' | 'call';
export type VisualState =
  | 'idle'
  | 'peripheral_pill'
  | 'expanded_card'
  | 'reply_active'
  | 'active_call'
  | 'sent_confirmation'
  | 'call_ended';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  subtitle: string;
  body: string;
  avatarText: string;
  avatarColor?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'them' | 'me';
  text: string;
  time: string;
}

export interface SmsItem {
  id: string;
  state: VisualState;
  payload: NotificationPayload | null;
  group: THREE.Group;
  pillMesh: THREE.Mesh;
  cardMesh: THREE.Mesh;
  pillCanvas: HTMLCanvasElement;
  pillCtx: CanvasRenderingContext2D;
  pillTexture: THREE.CanvasTexture;
  cardCanvas: HTMLCanvasElement;
  cardCtx: CanvasRenderingContext2D;
  cardTexture: THREE.CanvasTexture;
  animProgress: number;
  targetProgress: number;
  width: number;
  height: number;
  opacity: number;
  targetOpacity: number;
  chatMessages: ChatMessage[];
  replyText: string;
  receivedTime: number;
  hasReplied: boolean;
  lastExpandedState: VisualState;
  riseActive: boolean;
  isLookingAtCloseButton: boolean;
  isLookingAtSendButton: boolean;
  isLookingAtInputBar: boolean;
  replyBgCanvas?: HTMLCanvasElement;
  replyBgCtx?: CanvasRenderingContext2D;
  replyBgDirty?: boolean;
}

export class NotificationSystem {
  public anchorPosition: THREE.Vector3;
  private xr: XRManager;

  // ================= 1. DYNAMIC SMS SYSTEM (ARBITRARY VERTICAL STACKING) =================
  public readonly MAX_SMS = 8;
  public smsPool: SmsItem[] = [];
  public activeSmsList: SmsItem[] = [];

  private followUpReplies = [
    'Ok, thanks!',
    'Got it — I\'ll take a look.',
    'Sure, give me 5 minutes.',
    'On it!',
    'Sounds good.',
    'Can we push that to 4pm instead?',
    'Done! Just sent it over.',
  ];
  private followUpIndex = 0;

  // ── Auto-mode simulation ──
  private autoModeTimer: ReturnType<typeof setTimeout> | null = null;
  public isAutoMode = false;
  private _lastSmsSender: string | null = null;
  private _lastCallSender: string | null = null;

  // Realistic notification pool with vibrant distinct avatar colors for instant recognition
  private readonly SMS_POOL = [
    { title: 'Mom',           avatarText: 'M',  avatarColor: '#ec4899', body: 'Are you coming home for dinner tonight?' },
    { title: 'Alex Chen',     avatarText: 'AC', avatarColor: '#0284c7', body: 'Meeting pushed to 3pm — does that work for you?' },
    { title: 'David Park',    avatarText: 'DP', avatarColor: '#8b5cf6', body: 'Can you send over that document when you get a chance?' },
    { title: 'Sarah Chen',    avatarText: 'SC', avatarColor: '#10b981', body: 'Are the slides ready for the client review?' },
    { title: 'Jordan Lee',    avatarText: 'JL', avatarColor: '#f59e0b', body: 'Heads up — the deploy went out 10 mins ago.' },
    { title: 'Priya Nair',    avatarText: 'PN', avatarColor: '#06b6d4', body: 'Quick question about the Q3 report…' },
    { title: 'Marcus Wu',     avatarText: 'MW', avatarColor: '#3b82f6', body: 'Lunch at noon? Same spot as last week.' },
    { title: 'Olivia Scott',  avatarText: 'OS', avatarColor: '#84cc16', body: 'Just reviewed your PR — left a few comments.' },
    { title: 'Liam Vance',    avatarText: 'LV', avatarColor: '#f97316', body: 'Can you check the new 3D model when free?' },
    { title: 'Emily Watson',  avatarText: 'EW', avatarColor: '#14b8a6', body: 'The team approved the sprint proposal!' },
    { title: 'Daniel Craig',  avatarText: 'DC', avatarColor: '#6366f1', body: 'Flight details are confirmed for the summit.' },
    { title: 'Sophia Taylor', avatarText: 'ST', avatarColor: '#a855f7', body: 'Package delivered to the front reception.' },
  ];
  private readonly CALL_POOL = [
    { title: 'Alex Wong',     avatarText: 'AW', avatarColor: '#0284c7' },
    { title: 'Sarah Johnson', avatarText: 'SJ', avatarColor: '#10b981' },
    { title: 'David Kim',     avatarText: 'DK', avatarColor: '#8b5cf6' },
    { title: 'Emma Roberts',  avatarText: 'ER', avatarColor: '#ec4899' },
  ];

  private callRiseActive = false;

  // ================= 2. CALL SESSION =================
  public callState: VisualState = 'idle';
  public callReceivedTime = 0;
  public callPayload: NotificationPayload | null = null;
  public callGroup: THREE.Group;
  public callMesh: THREE.Mesh;
  public callCanvas: HTMLCanvasElement;
  public callCtx: CanvasRenderingContext2D;
  public callTexture: THREE.CanvasTexture;
  public callPillMesh!: THREE.Mesh;
  public callCardMesh!: THREE.Mesh;
  public callPillCanvas!: HTMLCanvasElement;
  public callPillCtx!: CanvasRenderingContext2D;
  public callPillTexture!: THREE.CanvasTexture;
  public callCardCanvas!: HTMLCanvasElement;
  public callCardCtx!: CanvasRenderingContext2D;
  public callCardTexture!: THREE.CanvasTexture;
  public callAnimProgress = 0.0;
  public callTargetProgress = 0.0;
  public callWidth = 0.24;
  public callHeight = 0.16;
  public callScaleAnim = 1.0;
  public callOpacity = 0;
  public callTargetOpacity = 0;
  public callConnectedTime = 0;
  private ringtoneInterval: number | null = null;
  public focusedCallButton: 'decline' | 'accept' | null = null;
  public isLookingAtEndCallButton = false;
  public callLastExpandedState: VisualState = 'expanded_card';

  // Active gaze focus channel (e.g. 'sms-0', 'sms-1', ... | 'call' | null)
  public activeFocusedChannel: string | null = null;

  // Gaze leave & responsive auto-collapse when user looks back to workspace
  public isLookingAtPhone = false;
  private gazeLeaveTimestamp = 0;
  private readonly COLLAPSE_DELAY_SEC = 0.38; // 380ms responsive look-away pause before smooth fold-down
  private phoneGazeStartTime = 0;
  private readonly GAZE_EXPAND_DWELL_SEC = 0.22; // 220ms natural dwell before smooth unfold

  // Cursor blink & input
  private cursorBlink = true;
  private lastBlinkTime = 0;
  private lastTrackpadClickTime = 0;

  // ================= 3. PHONE BASIC STATUS BAR =================
  public isPhoneMuted = false;
  public phoneBatteryLevel = 88;
  public isLookingAtMuteButton = false;
  public isLookingAtStatusBar = false;
  public isLookingAtPPT = false;
  private statusBarGazeStartTime = 0;
  public statusScaleAnim = 1.0;
  public statusGroup: THREE.Group;
  public statusMesh: THREE.Mesh;
  public statusCanvas: HTMLCanvasElement;
  public statusCtx: CanvasRenderingContext2D;
  public statusTexture: THREE.CanvasTexture;
  public statusWidth = 0.17;
  public statusHeight = 0.030;
  public statusVisible = false;
  private lastTimeStr = '';

  // Public callbacks for compatibility
  public onStateChanged?: (state: VisualState) => void;
  public onReplyStarted?: () => void;

  private createSmsItem(index: number): SmsItem {
    const group = new THREE.Group();
    group.position.copy(this.anchorPosition || new THREE.Vector3());
    group.position.y += 0.088;
    group.visible = false;

    // A. SMS Pill Canvas (1632x456 for 0.20m x 0.056m pill)
    const pillCanvas = document.createElement('canvas');
    pillCanvas.width = 1632;
    pillCanvas.height = 456;
    const pillCtx = pillCanvas.getContext('2d')!;
    const pillTexture = new THREE.CanvasTexture(pillCanvas);
    pillTexture.generateMipmaps = false;
    pillTexture.minFilter = THREE.LinearFilter;
    pillTexture.magFilter = THREE.LinearFilter;
    pillTexture.anisotropy = 1;

    const pillMat = new THREE.MeshBasicMaterial({
      map: pillTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    const pillMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.056), pillMat);
    pillMesh.userData = { interactive: false, role: `glancebar-sms-${index}-pill` };
    pillMesh.visible = false;
    pillMesh.renderOrder = 20 + index;
    group.renderOrder = 20 + index;
    group.add(pillMesh);

    // B. SMS Card Canvas (1824x1216 for 0.24m x 0.16m card)
    const cardCanvas = document.createElement('canvas');
    cardCanvas.width = 1824;
    cardCanvas.height = 1216;
    const cardCtx = cardCanvas.getContext('2d')!;
    const cardTexture = new THREE.CanvasTexture(cardCanvas);
    cardTexture.colorSpace = THREE.SRGBColorSpace;
    cardTexture.generateMipmaps = false;
    cardTexture.minFilter = THREE.LinearFilter;
    cardTexture.magFilter = THREE.LinearFilter;
    cardTexture.anisotropy = 1;

    const cardMat = new THREE.MeshBasicMaterial({
      map: cardTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), cardMat);
    cardMesh.userData = { interactive: false, role: `glancebar-sms-${index}` };
    cardMesh.visible = false;
    cardMesh.renderOrder = 20 + index;
    group.add(cardMesh);

    this.xr.scene.add(group);

    return {
      id: `sms-${index}`,
      state: 'idle',
      payload: null,
      group,
      pillMesh,
      cardMesh,
      pillCanvas,
      pillCtx,
      pillTexture,
      cardCanvas,
      cardCtx,
      cardTexture,
      animProgress: 0.0,
      targetProgress: 0.0,
      width: 0.24,
      height: 0.16,
      opacity: 0,
      targetOpacity: 0,
      chatMessages: [],
      replyText: '',
      receivedTime: 0,
      hasReplied: false,
      lastExpandedState: 'expanded_card',
      riseActive: false,
      isLookingAtCloseButton: false,
      isLookingAtSendButton: false,
      isLookingAtInputBar: false
    };
  }

  constructor(xr: XRManager, initialAnchor: THREE.Vector3) {
    this.xr = xr;
    this.anchorPosition = initialAnchor.clone();

    // 1. Initialize Reusable Dynamic SMS Pool (up to MAX_SMS coexisting bubbles)
    for (let i = 0; i < this.MAX_SMS; i++) {
      this.smsPool.push(this.createSmsItem(i));
    }

    // 2. Initialize Call 3D Group & Meshes (Pill Layer + Card Layer for smooth morphing)
    this.callGroup = new THREE.Group();
    this.callGroup.position.copy(this.anchorPosition);
    this.callGroup.position.y += 0.088;

    // A. Call Pill Canvas (1632x456 for 0.20m x 0.056m pill)
    this.callPillCanvas = document.createElement('canvas');
    this.callPillCanvas.width = 1632;
    this.callPillCanvas.height = 456;
    this.callPillCtx = this.callPillCanvas.getContext('2d')!;
    this.callPillTexture = new THREE.CanvasTexture(this.callPillCanvas);
    this.callPillTexture.colorSpace = THREE.SRGBColorSpace;
    this.callPillTexture.generateMipmaps = false;
    this.callPillTexture.minFilter = THREE.LinearFilter;
    this.callPillTexture.magFilter = THREE.LinearFilter;
    this.callPillTexture.anisotropy = 1;

    const callPillMat = new THREE.MeshBasicMaterial({
      map: this.callPillTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    this.callPillMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.056), callPillMat);
    this.callPillMesh.userData = { interactive: false, role: 'glancebar-call-pill' };
    this.callPillMesh.visible = false;
    this.callPillMesh.renderOrder = 30;
    this.callGroup.renderOrder = 30;
    this.callGroup.add(this.callPillMesh);

    // B. Call Card Canvas (1824x1216 for 0.24m x 0.16m card, perfectly matched 1.5:1 ratio)
    this.callCardCanvas = document.createElement('canvas');
    this.callCardCanvas.width = 1824;
    this.callCardCanvas.height = 1216;
    this.callCardCtx = this.callCardCanvas.getContext('2d')!;
    this.callCardTexture = new THREE.CanvasTexture(this.callCardCanvas);
    this.callCardTexture.colorSpace = THREE.SRGBColorSpace;
    this.callCardTexture.generateMipmaps = false;
    this.callCardTexture.minFilter = THREE.LinearFilter;
    this.callCardTexture.magFilter = THREE.LinearFilter;
    this.callCardTexture.anisotropy = 1;

    const callCardMat = new THREE.MeshBasicMaterial({
      map: this.callCardTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    this.callCardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), callCardMat);
    this.callCardMesh.userData = { interactive: false, role: 'glancebar-call' };
    this.callCardMesh.visible = false;
    this.callCardMesh.renderOrder = 30;
    this.callGroup.add(this.callCardMesh);

    // Aliases for compatibility
    this.callCanvas = this.callCardCanvas;
    this.callCtx = this.callCardCtx;
    this.callTexture = this.callCardTexture;
    this.callMesh = this.callCardMesh;

    this.xr.scene.add(this.callGroup);

    // 3. Initialize Phone Basic System Status Bar (Docked just above the physical desk ring)
    this.statusGroup = new THREE.Group();
    this.statusGroup.position.copy(this.anchorPosition);
    this.statusGroup.position.y = this.anchorPosition.y - 0.10 + 0.010;
    this.statusGroup.renderOrder = 15;

    // 2x Retina Supersampled Canvas (680x120 for 0.17m x 0.030m status strip)
    this.statusCanvas = document.createElement('canvas');
    this.statusCanvas.width = 680;
    this.statusCanvas.height = 120;
    this.statusCtx = this.statusCanvas.getContext('2d')!;

    this.statusTexture = new THREE.CanvasTexture(this.statusCanvas);
    this.statusTexture.colorSpace = THREE.SRGBColorSpace;
    this.statusTexture.generateMipmaps = false;
    this.statusTexture.minFilter = THREE.LinearFilter;
    this.statusTexture.magFilter = THREE.LinearFilter;
    this.statusTexture.anisotropy = 1;

    const statusGeo = new THREE.PlaneGeometry(this.statusWidth, this.statusHeight);
    const statusMat = new THREE.MeshBasicMaterial({
      map: this.statusTexture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });
    this.statusMesh = new THREE.Mesh(statusGeo, statusMat);
    this.statusMesh.userData = { interactive: false, role: 'phone-status-strip' };
    this.statusMesh.visible = false;
    this.statusMesh.renderOrder = 15;
    this.statusGroup.add(this.statusMesh);
    this.xr.scene.add(this.statusGroup);

    // Query browser battery if available
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      (navigator as any).getBattery().then((battery: any) => {
        this.phoneBatteryLevel = Math.round(battery.level * 100);
        this.renderStatusCanvas();
        battery.addEventListener('levelchange', () => {
          this.phoneBatteryLevel = Math.round(battery.level * 100);
          this.renderStatusCanvas();
        });
      }).catch(() => {});
    }

    this.renderSmsCanvas();
    this.renderCallCanvas();
    this.renderStatusCanvas();
  }

  // Helpers to get active/focused SMS item
  public get replyActiveItem(): SmsItem | null {
    return this.activeSmsList.find(item => item.state === 'reply_active') || null;
  }

  public get focusedSmsItem(): SmsItem | null {
    if (this.activeFocusedChannel?.startsWith('sms-')) {
      const match = this.activeSmsList.find(item => item.id === this.activeFocusedChannel);
      if (match) return match;
    }
    return this.activeSmsList.length > 0 ? this.activeSmsList[this.activeSmsList.length - 1] : null;
  }

  // Compatibility getters & setters
  public get replyText(): string {
    const item = this.replyActiveItem || this.focusedSmsItem;
    return item ? item.replyText : '';
  }
  public set replyText(v: string) {
    const item = this.replyActiveItem || this.focusedSmsItem;
    if (item) {
      item.replyText = v;
      this.renderSmsCardCanvas(item);
    }
  }

  public get smsState(): VisualState {
    const item = this.replyActiveItem || this.focusedSmsItem;
    return item ? item.state : 'idle';
  }

  public get smsPayload(): NotificationPayload | null {
    const item = this.replyActiveItem || this.focusedSmsItem;
    return item ? item.payload : null;
  }

  public get currentState(): VisualState {
    if (this.callState !== 'idle') return this.callState;
    const item = this.replyActiveItem || this.focusedSmsItem;
    return item ? item.state : 'idle';
  }

  public isReplyActive(): boolean {
    return this.activeSmsList.some(item => item.state === 'reply_active');
  }

  public updateAnchor(pos: THREE.Vector3) {
    this.anchorPosition.copy(pos);
  }

  // Compatibility method
  public renderCanvas() {
    this.renderSmsCanvas();
    this.renderCallCanvas();
    this.renderStatusCanvas();
  }

  public setStatusVisible(visible: boolean) {
    this.statusVisible = visible;
    this.statusMesh.visible = visible;
    if (visible) {
      this.renderStatusCanvas();
    }
  }

  public togglePhoneMute() {
    this.isPhoneMuted = !this.isPhoneMuted;
    audioManager.playPinchClick(); // Play immediate click audio feedback
    audioManager.setMuted(this.isPhoneMuted);
    if (this.isPhoneMuted) {
      this.stopRingtone();
    }
    this.renderStatusCanvas();
  }

  // ================= NOTIFICATION TRIGGERING =================

  /** Pick a random SMS — strictly excludes senders that currently have an active bubble on screen */
  public triggerRandomSMS() {
    // 1. Gather senders currently visible in active bubbles
    const activeSenders = new Set(
      this.activeSmsList.map(item => item.payload?.title).filter(Boolean)
    );

    // 2. Select from senders who do NOT currently have a bubble on screen
    const available = this.SMS_POOL.filter(p => !activeSenders.has(p.title) && p.title !== this._lastSmsSender);
    const fallback = this.SMS_POOL.filter(p => !activeSenders.has(p.title));
    const pool = available.length > 0 ? available : (fallback.length > 0 ? fallback : this.SMS_POOL);
    const pick = pool[Math.floor(Math.random() * pool.length)];

    this._lastSmsSender = pick.title;
    this.triggerNotification({ type: 'sms', ...pick, subtitle: 'Message' });
  }

  /** Pick a random caller — avoids repeating same caller back-to-back */
  public triggerRandomCall() {
    const pool = this.CALL_POOL;
    const filtered = pool.filter(p => p.title !== this._lastCallSender);
    const candidates = filtered.length > 0 ? filtered : pool;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this._lastCallSender = pick.title;
    this.triggerNotification({ type: 'call', ...pick, subtitle: 'Incoming Call', body: 'Incoming Call' });
  }

  /** Start auto-mode: fires random SMS or call every ~10 seconds */
  public startAutoMode(initialDelay = 2500) {
    this.isAutoMode = true;
    if (this.autoModeTimer !== null) {
      clearTimeout(this.autoModeTimer);
      this.autoModeTimer = null;
    }
    this._scheduleNextAutoNotification(initialDelay);
  }

  public stopAutoMode() {
    this.isAutoMode = false;
    if (this.autoModeTimer !== null) {
      clearTimeout(this.autoModeTimer);
      this.autoModeTimer = null;
    }
  }

  private _scheduleNextAutoNotification(overrideDelay?: number) {
    if (!this.isAutoMode) return;
    // ~10 second interval (8–12s) with slight natural jitter
    const delay = overrideDelay !== undefined ? overrideDelay : (8 + Math.random() * 4) * 1000;
    this.autoModeTimer = setTimeout(() => {
      if (!this.isAutoMode) return;
      // 70% SMS, 30% call
      if (Math.random() < 0.7) {
        this.triggerRandomSMS();
      } else {
        this.triggerRandomCall();
      }
      this._scheduleNextAutoNotification();
    }, delay);
  }

  public triggerNotification(payload?: Partial<NotificationPayload>) {
    if (!this.statusVisible) {
      this.setStatusVisible(true);
    }
    const type = payload?.type || 'sms';

    if (type === 'sms') {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      const senderTitle = payload?.title || 'Sarah Chen';
      const senderAvatar = payload?.avatarText || 'SC';
      const senderColor = payload?.avatarColor || '#0ea5e9';
      const senderBody = payload?.body || 'Are the slides ready for our client review?';

      const newPayload: NotificationPayload = {
        type: 'sms',
        title: senderTitle,
        subtitle: payload?.subtitle || 'Message',
        body: senderBody,
        avatarText: senderAvatar,
        avatarColor: senderColor
      };

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        sender: 'them',
        text: senderBody,
        time: timeStr
      };

      const deskY = this.anchorPosition.y - 0.10;

      // If active list reached MAX_SMS, dismiss the oldest one at the bottom so stack stays manageable
      if (this.activeSmsList.length >= this.MAX_SMS) {
        const oldest = this.activeSmsList[0];
        this.dismissSmsItem(oldest, false);
      }

      // Find an available idle item from smsPool
      const availableItem = this.smsPool.find(item => item.state === 'idle' && !this.activeSmsList.includes(item)) || this.smsPool[0];

      availableItem.payload = newPayload;
      availableItem.chatMessages = [newMsg];
      availableItem.replyText = '';
      availableItem.receivedTime = performance.now();
      availableItem.hasReplied = false;
      availableItem.lastExpandedState = 'expanded_card';
      availableItem.isLookingAtSendButton = false;
      availableItem.isLookingAtCloseButton = false;
      availableItem.isLookingAtInputBar = false;

      // Start bubble floating ascent from phone surface
      availableItem.group.position.set(this.anchorPosition.x, deskY, this.anchorPosition.z);
      availableItem.group.visible = true;
      availableItem.opacity = 0;
      availableItem.riseActive = true;

      this.switchSmsState('peripheral_pill', availableItem);
      this.activeSmsList.push(availableItem);
      this.activeFocusedChannel = availableItem.id;

      // Only chime if phone is NOT muted (protecting user focus!)
      if (!this.isPhoneMuted) {
        audioManager.playNotificationChime();
      }
    } else {
      this.stopRingtone();
      this.callReceivedTime = performance.now();
      this.callPayload = {
        type: 'call',
        title: payload?.title || 'Alex Wong',
        subtitle: payload?.subtitle || 'Incoming Call',
        body: 'Incoming Call',
        avatarText: payload?.avatarText || 'AW',
        avatarColor: payload?.avatarColor || '#10b981'
      };
      this.callLastExpandedState = 'expanded_card';
      this.focusedCallButton = null;
      this.isLookingAtEndCallButton = false;

      // Always trigger bubble floating ascent from phone surface on every incoming call!
      const deskY = this.anchorPosition.y - 0.10;
      this.callGroup.position.y = deskY;
      this.callOpacity = 0;
      this.callRiseActive = true;
      this.switchCallState('peripheral_pill');

      // Only ring if phone is NOT muted
      if (!this.isPhoneMuted) {
        audioManager.playRingTone();
        this.ringtoneInterval = window.setInterval(() => {
          if (!this.isPhoneMuted && (this.callState === 'peripheral_pill' || this.callState === 'expanded_card')) {
            audioManager.playRingTone();
          } else {
            this.stopRingtone();
          }
        }, 2500);
      }
      this.activeFocusedChannel = 'call';
    }
  }

  private stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  // ================= STATE SWITCHING =================
  public switchSmsState(state: VisualState, target?: SmsItem | number) {
    let item: SmsItem | null = null;
    if (typeof target === 'object' && target !== null) {
      item = target;
    } else if (typeof target === 'number') {
      item = this.activeSmsList[target] || null;
    } else {
      item = this.replyActiveItem || this.focusedSmsItem;
    }

    if (!item) return;

    const wasIdle = item.state === 'idle';
    item.state = state;
    this.onStateChanged?.(state);

    if (state === 'peripheral_pill') {
      item.targetProgress = 0.0;
      item.targetOpacity = 0.96;
      this.renderSmsPillCanvas(item);
      if (wasIdle) {
        const deskY = this.anchorPosition.y - 0.10;
        item.group.position.y = deskY;
        item.opacity = 0;
        item.riseActive = true;
      }
    } else if (state === 'expanded_card' || state === 'reply_active') {
      item.targetProgress = 1.0;
      item.targetOpacity = 1.0;
      item.replyBgDirty = true;
      this.renderSmsCardCanvas(item);
    } else if (state === 'idle') {
      item.targetProgress = 0.0;
      item.targetOpacity = 0;
      item.riseActive = false;
    }
  }

  public switchCallState(state: VisualState) {
    const wasIdle = this.callState === 'idle';
    this.callState = state;
    this.onStateChanged?.(state);

    if (state === 'peripheral_pill') {
      this.callTargetProgress = 0.0;
      this.callTargetOpacity = 0.96;
      this.renderCallPillCanvas();
      // First arrival from idle → snap to desk level so it rises into view
      if (wasIdle) {
        const deskY = this.anchorPosition.y - 0.10;
        this.callGroup.position.y = deskY;
        this.callOpacity = 0;
        this.callRiseActive = true;
      }
    } else if (state === 'expanded_card') {
      this.callTargetProgress = 1.0;
      this.callTargetOpacity = 1.0;
      this.renderCallCardCanvas();
    } else if (state === 'active_call') {
      this.callTargetProgress = 1.0;
      this.callTargetOpacity = 1.0;
      this.renderCallCardCanvas();
    } else if (state === 'call_ended') {
      this.callTargetProgress = 0.0;
      this.callTargetOpacity = 1.0;
      this.renderCallPillCanvas();
    } else if (state === 'idle') {
      this.callTargetProgress = 0.0;
      this.callTargetOpacity = 0;
      this.callRiseActive = false;
      this.stopRingtone();
    }
  }

  // ================= CALL ACTIONS =================
  public acceptCall() {
    this.stopRingtone();
    audioManager.playPinchClick();
    this.callConnectedTime = performance.now();
    this.callLastExpandedState = 'active_call';
    this.switchCallState('active_call');
  }

  public declineCall() {
    this.stopRingtone();
    audioManager.playCallEnd();
    this.switchCallState('call_ended');
    setTimeout(() => {
      this.dismiss('call');
    }, 1500);
  }

  public endCall() {
    this.stopRingtone();
    audioManager.playCallEnd();
    this.switchCallState('call_ended');
    setTimeout(() => {
      this.dismiss('call');
    }, 1500);
  }

  public sendReply() {
    const item = this.replyActiveItem || this.focusedSmsItem;
    if (!item) return;

    const textToSend = item.replyText.trim() || 'Sounds good, on it!';
    audioManager.playSendSwoosh();

    const now = new Date();
    const timeStr = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;

    item.chatMessages.push({
      id: `msg-${Date.now()}`,
      sender: 'me',
      text: textToSend,
      time: timeStr
    });

    item.replyText = '';
    item.hasReplied = true;
    item.isLookingAtSendButton = false;

    item.lastExpandedState = 'expanded_card';
    this.switchSmsState('expanded_card', item);
  }

  public dismissSmsItem(item: SmsItem, playSound = true) {
    if (playSound) audioManager.playPinchClick();
    item.state = 'idle';
    item.targetOpacity = 0;
    item.targetProgress = 0;
    item.riseActive = false;
    item.payload = null;
    item.chatMessages = [];
    item.replyText = '';
    item.receivedTime = 0;
    item.hasReplied = false;
    item.group.visible = false;
    item.pillMesh.visible = false;
    item.cardMesh.visible = false;

    const idx = this.activeSmsList.indexOf(item);
    if (idx !== -1) {
      this.activeSmsList.splice(idx, 1);
    }
    if (this.activeFocusedChannel === item.id) {
      this.activeFocusedChannel = null;
    }
  }

  public dismiss(type?: 'sms' | 'call', target?: 0 | 1 | SmsItem) {
    if (!type || type === 'sms') {
      if (typeof target === 'object' && target !== null) {
        this.dismissSmsItem(target);
      } else if (typeof target === 'number') {
        const item = this.activeSmsList[target];
        if (item) this.dismissSmsItem(item);
      } else {
        // Dismiss all active SMS items
        for (const item of [...this.activeSmsList]) {
          this.dismissSmsItem(item, false);
        }
      }
    }
    if (!type || type === 'call') {
      this.stopRingtone();
      this.switchCallState('idle');
      this.callPayload = null;
      this.focusedCallButton = null;
      this.isLookingAtEndCallButton = false;
      this.callReceivedTime = 0;
      this.callConnectedTime = 0;
    }
  }

  // ================= GAZE ENTER / LEAVE =================
  public onGazeEnter() {
    this.isLookingAtPhone = true;
    if (this.phoneGazeStartTime === 0) {
      this.phoneGazeStartTime = performance.now();
    }
    this.gazeLeaveTimestamp = 0;
  }

  public onGazeLeave() {
    this.isLookingAtPhone = false;
    this.phoneGazeStartTime = 0;
    this.gazeLeaveTimestamp = performance.now();
  }

  // ================= GAZE ACTION COMMIT (TRACKPAD TAP OR AIR PINCH) =================
  public handleTrackpadClick(): boolean {
    const now = performance.now();
    if (now - this.lastTrackpadClickTime < 300) {
      return false;
    }
    this.lastTrackpadClickTime = now;

    // 0. If user looks away from the phone without clicking send, defocus back to expanded card
    // while preserving the typed draft so they can continue typing when glancing back.
    if (!this.isLookingAtPhone) {
      const activeReply = this.replyActiveItem;
      if (activeReply) {
        audioManager.playPinchClick();
        activeReply.lastExpandedState = 'expanded_card';
        this.switchSmsState('expanded_card', activeReply);
        return true;
      }

      if (this.isLookingAtPPT) {
        let handled = false;
        for (const item of this.activeSmsList) {
          if (item.state === 'expanded_card') {
            audioManager.playPinchClick();
            item.lastExpandedState = 'expanded_card';
            this.switchSmsState('peripheral_pill', item);
            handled = true;
          }
        }
        if (this.callState === 'expanded_card' || this.callState === 'active_call') {
          audioManager.playPinchClick();
          this.callLastExpandedState = this.callState;
          this.switchCallState('peripheral_pill');
          handled = true;
        }
        return handled;
      }

      return false; // Looking at other areas, ignore
    }

    // 1. Priority: If looking at the Phone Status Bar Mute Button -> toggle mute!
    if (this.isLookingAtMuteButton) {
      this.togglePhoneMute();
      return true;
    }

    // 2. Priority: If looking at SMS Close Button (top-right corner ✕) -> dismiss SMS panel!
    const closeItem = this.activeSmsList.find(item => item.isLookingAtCloseButton);
    if (closeItem) {
      audioManager.playPinchClick();
      this.dismissSmsItem(closeItem);
      return true;
    }

    // Determine target based on currently expanded card or active channel
    const callIsExpanded = this.callState === 'expanded_card' || this.callState === 'active_call';

    // 1. If Call is the expanded card
    if (callIsExpanded) {
      if (this.callState === 'expanded_card') {
        if (this.focusedCallButton === 'accept') {
          this.acceptCall();
          return true;
        } else if (this.focusedCallButton === 'decline') {
          this.declineCall();
          return true;
        }
        return false;
      }
      if (this.callState === 'active_call') {
        if (this.isLookingAtEndCallButton) {
          this.endCall();
          return true;
        }
        return false;
      }
    }

    // 2. If an SMS is expanded or reply_active
    for (const item of this.activeSmsList) {
      if (item.state === 'expanded_card') {
        if (item.isLookingAtInputBar) {
          audioManager.playPinchClick();
          this.switchSmsState('reply_active', item);
          item.lastExpandedState = 'reply_active';
          this.onReplyStarted?.();
          return true;
        }
      } else if (item.state === 'reply_active') {
        if (item.isLookingAtSendButton) {
          this.sendReply();
        } else {
          audioManager.playPinchClick();
          item.lastExpandedState = 'expanded_card';
          this.switchSmsState('expanded_card', item);
        }
        return true;
      }
    }

    // 3. If in peripheral pill mode: expand whichever channel gaze is focused on
    if (this.activeFocusedChannel === 'call' && this.callState === 'peripheral_pill') {
      audioManager.playPinchClick();
      this.switchCallState(this.callLastExpandedState || 'expanded_card');
      for (const item of this.activeSmsList) {
        if (item.state !== 'idle') this.switchSmsState('peripheral_pill', item);
      }
      return true;
    }

    if (this.activeFocusedChannel?.startsWith('sms-')) {
      const focusedItem = this.activeSmsList.find(i => i.id === this.activeFocusedChannel);
      if (focusedItem && focusedItem.state === 'peripheral_pill') {
        audioManager.playPinchClick();
        this.switchSmsState(focusedItem.lastExpandedState || 'expanded_card', focusedItem);
        for (const other of this.activeSmsList) {
          if (other !== focusedItem && other.state !== 'idle') {
            this.switchSmsState('peripheral_pill', other);
          }
        }
        if (this.callState !== 'idle') this.switchCallState('peripheral_pill');
        return true;
      }
    }

    return false;
  }

  /**
   * Universal Gaze Commit alias for both Trackpad Tap and Air Pinch
   */
  public handleGazeCommit(): boolean {
    return this.handleTrackpadClick();
  }

  // ================= GAZE RAYCASTING HELPER =================
  private getGazeCanvasCoords(
    group: THREE.Group,
    planeW: number,
    planeH: number,
    logicalW: number,
    logicalH: number,
    margin = 0.015
  ): { px: number; py: number } | null {
    const camPos = this.xr.getCameraPosition();
    const camDir = this.xr.getGazeDirection();

    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
    const cardPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, group.position);
    const gazeRay = new THREE.Ray(camPos, camDir);
    const hitPoint = new THREE.Vector3();

    if (!gazeRay.intersectPlane(cardPlane, hitPoint)) {
      return null;
    }

    const localHit = group.worldToLocal(hitPoint);
    const halfW = planeW / 2;
    const halfH = planeH / 2;

    if (
      localHit.x < -halfW - margin ||
      localHit.x > halfW + margin ||
      localHit.y < -halfH - margin ||
      localHit.y > halfH + margin
    ) {
      return null;
    }

    const clampedX = Math.max(-halfW, Math.min(halfW, localHit.x));
    const clampedY = Math.max(-halfH, Math.min(halfH, localHit.y));

    const px = ((clampedX + halfW) / planeW) * logicalW;
    const py = ((halfH - clampedY) / planeH) * logicalH;

    return { px, py };
  }

  // ================= CANVAS DRAWING HELPERS =================
  private drawFrostedGlassPanel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    tint = 'rgba(255, 255, 255, 0.28)'
  ) {
    ctx.save();
    // High-contrast drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 6;

    // Translucent glass backdrop
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, tint);
    grad.addColorStop(1, 'rgba(240, 245, 255, 0.16)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.restore();

    // Solid, crisp luminous border (prevents blurry lines at distance)
    const borderGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    borderGrad.addColorStop(0, 'rgba(255, 255, 255, 0.90)');
    borderGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
    borderGrad.addColorStop(1, 'rgba(255, 255, 255, 0.70)');
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
  }

  private drawCloseButton(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, isFocused = false) {
    const r = 20;

    ctx.save();
    if (isFocused) {
      ctx.shadowColor = 'rgba(239, 68, 68, 0.90)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.40)';
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2.5;
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = 1.6;
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const iconColor = isFocused ? '#ffffff' : 'rgba(255, 255, 255, 0.88)';
    drawIcon(ctx, ICONS['x'], centerX, centerY, 18, iconColor, 2.5);
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        lines.push('');
        continue;
      }

      const words = paragraph.split(' ');
      if (words.length > 1) {
        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const testLine = currentLine + ' ' + word;
          if (ctx.measureText(testLine).width <= maxWidth) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        lines.push(currentLine);
      } else {
        let currentLine = '';
        for (const char of paragraph) {
          const testLine = currentLine + char;
          if (ctx.measureText(testLine).width <= maxWidth) {
            currentLine = testLine;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = char;
          }
        }
        if (currentLine) lines.push(currentLine);
      }
    }
    return lines;
  }

  private drawChatMessages(
    ctx: CanvasRenderingContext2D,
    startY: number,
    maxY: number,
    cardW: number,
    messages: ChatMessage[] = []
  ) {
    if (messages.length === 0) return;

    const msgMetrics: { lines: string[]; bubbleW: number; bubbleH: number }[] = [];
    ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
    const lineHeight = 34;

    for (const msg of messages) {
      const lines = this.wrapText(ctx, msg.text, 560);
      const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const bubbleW = Math.min(620, Math.max(160, maxLineWidth + 50));
      const bubbleH = lines.length * lineHeight + 28;
      msgMetrics.push({ lines, bubbleW, bubbleH });
    }

    const gap = 12;
    let visibleCount = 0;
    let accumulatedH = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const h = msgMetrics[i].bubbleH + (visibleCount > 0 ? gap : 0);
      if (accumulatedH + h <= maxY - startY || visibleCount === 0) {
        accumulatedH += h;
        visibleCount++;
      } else {
        break;
      }
    }

    const startIndex = messages.length - visibleCount;
    let currentY = startY + Math.max(0, (maxY - startY - accumulatedH) / 2);

    for (let i = startIndex; i < messages.length; i++) {
      const msg = messages[i];
      const metric = msgMetrics[i];
      const isMe = msg.sender === 'me';

      const bubbleX = isMe ? cardW - 40 - metric.bubbleW : 40;
      const bubbleY = currentY;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.30)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;

      if (isMe) {
        // Outgoing: Vivid Apple Blue gradient
        const bubbleGrad = ctx.createLinearGradient(bubbleX, bubbleY, bubbleX, bubbleY + metric.bubbleH);
        bubbleGrad.addColorStop(0, '#0284c7');
        bubbleGrad.addColorStop(1, '#0369a1');
        ctx.fillStyle = bubbleGrad;
      } else {
        // Incoming: Solid crisp light bubble for ultra-high contrast & razor-sharp legibility
        const bubbleGrad = ctx.createLinearGradient(bubbleX, bubbleY, bubbleX, bubbleY + metric.bubbleH);
        bubbleGrad.addColorStop(0, '#ffffff');
        bubbleGrad.addColorStop(1, '#f1f5f9');
        ctx.fillStyle = bubbleGrad;
      }

      const radii = isMe ? [22, 22, 6, 22] : [22, 22, 22, 6];
      ctx.beginPath();
      ctx.roundRect(bubbleX, bubbleY, metric.bubbleW, metric.bubbleH, radii);
      ctx.fill();

      ctx.strokeStyle = isMe ? '#7dd3fc' : '#cbd5e1';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      if (isMe) {
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#0f172a'; // Deep slate black text on white bubble: 100% contrast & sharpness
      }
      ctx.font = 'bold 26px "Plus Jakarta Sans", -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let l = 0; l < metric.lines.length; l++) {
        ctx.fillText(metric.lines[l], bubbleX + 26, bubbleY + 14 + l * lineHeight);
      }
      ctx.restore();

      currentY += metric.bubbleH + gap;
    }
  }

  // ================= 1. RENDER SMS CANVASES =================
  public renderSmsPillCanvas(target?: SmsItem | number) {
    let item: SmsItem | null = null;
    if (typeof target === 'object' && target !== null) {
      item = target;
    } else if (typeof target === 'number') {
      item = this.activeSmsList[target] || this.smsPool[target] || null;
    } else {
      item = this.replyActiveItem || this.focusedSmsItem;
    }

    if (!item) {
      for (const poolItem of this.smsPool) {
        this.renderSingleSmsPillCanvas(poolItem);
      }
      return;
    }

    this.renderSingleSmsPillCanvas(item);
  }

  private renderSingleSmsPillCanvas(item: SmsItem) {
    const ctx = item.pillCtx;
    const canvas = item.pillCanvas;
    const payload = item.payload || {
      type: 'sms' as NotificationType,
      title: 'Sarah Chen',
      subtitle: 'Design Lead',
      body: 'Hello! Are the slides ready for our client review? Let me know!',
      avatarText: 'SC'
    };
    const chatMessages = item.chatMessages;
    const texture = item.pillTexture;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const applyTextShadow = () => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    };
    const clearTextShadow = () => {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    };

    this.drawFrostedGlassPanel(ctx, 12, 12, 792, 204, 102, 'rgba(56, 189, 248, 0.26)');

    // Avatar
    ctx.fillStyle = payload.avatarColor || 'rgba(14, 165, 233, 0.75)';
    ctx.beginPath();
    ctx.arc(114, 114, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    applyTextShadow();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(payload.avatarText, 114, 114);

    ctx.textAlign = 'left';
    ctx.font = 'bold 42px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(payload.title, 210, 94);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    ctx.font = '28px "Plus Jakarta Sans", sans-serif';
    const lastMsg = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
    const snippet = lastMsg && lastMsg.sender === 'me' ? `You: ${lastMsg.text}` : payload.body;
    ctx.fillText(snippet.length > 28 ? snippet.slice(0, 26) + '...' : snippet, 210, 146);
    clearTextShadow();

    texture.needsUpdate = true;
  }

  public renderSmsCardCanvas(target?: SmsItem | number) {
    let item: SmsItem | null = null;
    if (typeof target === 'object' && target !== null) {
      item = target;
    } else if (typeof target === 'number') {
      item = this.activeSmsList[target] || this.smsPool[target] || null;
    } else {
      item = this.replyActiveItem || this.focusedSmsItem;
    }

    if (!item) {
      for (const poolItem of this.smsPool) {
        this.renderSingleSmsCardCanvas(poolItem);
      }
      return;
    }

    this.renderSingleSmsCardCanvas(item);
  }

  private renderSingleSmsCardCanvas(item: SmsItem) {
    const ctx = item.cardCtx;
    const canvas = item.cardCanvas;
    const state = item.state;
    const payload = item.payload || {
      type: 'sms' as NotificationType,
      title: 'Sarah Chen',
      subtitle: 'Design Lead',
      body: 'Hello! Are the slides ready for our client review? Let me know!',
      avatarText: 'SC',
      avatarColor: '#10b981'
    };
    const chatMessages = item.chatMessages;
    const replyText = item.replyText;
    const isLookingAtClose = item.isLookingAtCloseButton;
    const isLookingAtInput = item.isLookingAtInputBar;
    const isLookingAtSend = item.isLookingAtSendButton;
    const texture = item.cardTexture;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const applyTextShadow = () => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    };
    const clearTextShadow = () => {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    };

    // B. SMS Expanded Card (Chat Thread + Placeholder Pill)
    if (state !== 'reply_active') {
      const w = 912;
      const h = 608;
      this.drawFrostedGlassPanel(ctx, 12, 12, w - 24, h - 24, 32, 'rgba(255, 255, 255, 0.26)');

      // Contact Header
      ctx.fillStyle = payload.avatarColor || 'rgba(14, 165, 233, 0.75)';
      ctx.beginPath();
      ctx.arc(68, 64, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      applyTextShadow();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(payload.avatarText, 68, 64);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(payload.title, 114, 52);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '18px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Message • Now', 114, 80);

      // Close Button (User requested: close button in top-right to dismiss)
      this.drawCloseButton(ctx, w - 54, 64, isLookingAtClose);

      // Divider line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(36, 108);
      ctx.lineTo(w - 36, 108);
      ctx.stroke();

      // Timestamp
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.60)';
      ctx.font = '18px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Today 10:42 AM', w / 2, 136);

      // Chat Messages (Spacious thread area from 150px to 500px)
      this.drawChatMessages(ctx, 150, 500, w, chatMessages);

      // Bottom Input Bar (User requested: look at input bar and tap to start typing, shows draft text)
      const bY = h - 82;
      const bH = 54;
      const bW = w - 80;
      const hasDraft = replyText.trim().length > 0;

      ctx.save();
      if (isLookingAtInput) {
        ctx.shadowColor = 'rgba(56, 189, 248, 0.85)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.8;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.strokeStyle = hasDraft ? 'rgba(56, 189, 248, 0.60)' : 'rgba(255, 255, 255, 0.40)';
        ctx.lineWidth = 2;
      }

      ctx.beginPath();
      ctx.roundRect(40, bY, bW, bH, 27);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (hasDraft) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
        const display = replyText.length > 34 ? '...' + replyText.slice(-31) : replyText;
        ctx.fillText(display, 64, bY + bH / 2);
      } else {
        ctx.fillStyle = isLookingAtInput ? '#ffffff' : 'rgba(255, 255, 255, 0.75)';
        ctx.font = '22px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('Message...', 88, bY + bH / 2);
        // Small message icon before placeholder
        drawIcon(ctx, ICONS['message-circle'], 54, bY + bH / 2, 18, isLookingAtInput ? '#ffffff' : 'rgba(255,255,255,0.45)', 2);
      }

      const sendColor = isLookingAtInput ? '#38bdf8' : (hasDraft ? '#38bdf8' : 'rgba(255, 255, 255, 0.70)');
      drawIcon(ctx, ICONS['send-horizontal'], w - 68, bY + bH / 2, 24, sendColor, 2);

      clearTextShadow();
      texture.needsUpdate = true;
      return;
    }

    // C. SMS Reply Active (Chat Thread + Interactive Input Box & Send Arrow)
    if (state === 'reply_active') {
      const w = 912;
      const h = 608;

      if (!item.replyBgCanvas) {
        item.replyBgCanvas = document.createElement('canvas');
        item.replyBgCanvas.width = canvas.width;
        item.replyBgCanvas.height = canvas.height;
        item.replyBgCtx = item.replyBgCanvas.getContext('2d')!;
        item.replyBgDirty = true;
      }

      if (item.replyBgDirty) {
        const bgCtx = item.replyBgCtx!;
        bgCtx.setTransform(1, 0, 0, 1, 0, 0);
        bgCtx.clearRect(0, 0, canvas.width, canvas.height);
        bgCtx.setTransform(2, 0, 0, 2, 0, 0);

        this.drawFrostedGlassPanel(bgCtx, 12, 12, w - 24, h - 24, 32, 'rgba(255, 255, 255, 0.28)');

        // Contact Header
        bgCtx.fillStyle = payload.avatarColor || 'rgba(14, 165, 233, 0.75)';
        bgCtx.beginPath();
        bgCtx.arc(68, 64, 30, 0, Math.PI * 2);
        bgCtx.fill();
        bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        bgCtx.lineWidth = 2.5;
        bgCtx.stroke();

        bgCtx.save();
        bgCtx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        bgCtx.shadowBlur = 8;
        bgCtx.shadowOffsetY = 2;
        bgCtx.fillStyle = '#ffffff';
        bgCtx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
        bgCtx.textAlign = 'center';
        bgCtx.textBaseline = 'middle';
        bgCtx.fillText(payload.avatarText, 68, 64);

        bgCtx.textAlign = 'left';
        bgCtx.font = 'bold 32px "Plus Jakarta Sans", sans-serif';
        bgCtx.fillText(payload.title, 114, 52);

        bgCtx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        bgCtx.font = '18px "Plus Jakarta Sans", sans-serif';
        bgCtx.fillText('Message • Now', 114, 80);
        bgCtx.restore();

        // Close Button (dismiss)
        this.drawCloseButton(bgCtx, w - 54, 64, isLookingAtClose);

        // Divider line
        bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        bgCtx.lineWidth = 1.5;
        bgCtx.beginPath();
        bgCtx.moveTo(36, 108);
        bgCtx.lineTo(w - 36, 108);
        bgCtx.stroke();

        // Timestamp
        bgCtx.textAlign = 'center';
        bgCtx.fillStyle = 'rgba(255, 255, 255, 0.60)';
        bgCtx.font = '18px "Plus Jakarta Sans", sans-serif';
        bgCtx.fillText('Today 10:42 AM', w / 2, 136);

        // Chat Messages
        this.drawChatMessages(bgCtx, 150, 490, w, chatMessages);

        item.replyBgDirty = false;
      }

      // Blit cached background in 0.02ms!
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(item.replyBgCanvas, 0, 0);
      ctx.setTransform(2, 0, 0, 2, 0, 0);

      // Interactive Input Row & Send Button
      const inputY = 512;
      const inputH = 68;
      const hasText = replyText.trim().length > 0;

      // Input Capsule
      const inputW = 710;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.beginPath();
      ctx.roundRect(40, inputY, inputW, inputH, 24);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (hasText) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
        const display =
          replyText.length > 34 ? '...' + replyText.slice(-31) : replyText;
        ctx.fillText(display + (this.cursorBlink ? '|' : ''), 68, inputY + inputH / 2);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.font = '26px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('Message...' + (this.cursorBlink ? '|' : ''), 68, inputY + inputH / 2);
      }

      // Circular Send Button
      const btnRadius = 34;
      const btnCenterX = 824;
      const btnCenterY = inputY + inputH / 2;

      ctx.save();
      if (isLookingAtSend) {
        ctx.shadowColor = 'rgba(56, 189, 248, 0.95)';
        ctx.shadowBlur = 32;
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(btnCenterX, btnCenterY, btnRadius + 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isLookingAtSend
        ? '#0284c7'
        : hasText
        ? 'rgba(2, 132, 199, 0.80)'
        : 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(btnCenterX, btnCenterY, btnRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isLookingAtSend
        ? '#bae6fd'
        : hasText
        ? '#7dd3fc'
        : 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = isLookingAtSend ? 3 : 2.5;
      ctx.stroke();
      ctx.restore();

      drawIcon(ctx, ICONS['send-horizontal'], btnCenterX, btnCenterY, 28, '#ffffff', 2);

      texture.needsUpdate = true;
      return;
    }
  }

  public renderSmsCanvas(target?: SmsItem | number | 'all') {
    if (typeof target === 'object' && target !== null) {
      this.renderSmsPillCanvas(target);
      this.renderSmsCardCanvas(target);
    } else if (typeof target === 'number') {
      const item = this.activeSmsList[target] || this.smsPool[target];
      if (item) {
        this.renderSmsPillCanvas(item);
        this.renderSmsCardCanvas(item);
      }
    } else {
      for (const item of this.smsPool) {
        this.renderSmsPillCanvas(item);
        this.renderSmsCardCanvas(item);
      }
    }
  }

  // ================= 2. RENDER CALL CANVASES =================
  public renderCallPillCanvas() {
    const ctx = this.callPillCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.callPillCanvas.width, this.callPillCanvas.height);
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const payload = this.callPayload || {
      type: 'call' as NotificationType,
      title: 'Alex Wong',
      subtitle: 'Incoming Call',
      body: 'Incoming Call',
      avatarText: 'AW'
    };

    const applyTextShadow = () => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    };
    const clearTextShadow = () => {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    };

    const isEnded = this.callState === 'call_ended';
    const tint = isEnded ? 'rgba(239, 68, 68, 0.26)' : 'rgba(16, 185, 129, 0.28)';
    this.drawFrostedGlassPanel(ctx, 12, 12, 792, 204, 102, tint);

    ctx.fillStyle = isEnded ? 'rgba(239, 68, 68, 0.65)' : (payload.avatarColor || 'rgba(16, 185, 129, 0.75)');
    ctx.beginPath();
    ctx.arc(114, 114, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    applyTextShadow();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(payload.avatarText, 114, 114);

    ctx.textAlign = 'left';
    ctx.font = 'bold 42px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(payload.title, 210, 94);

    ctx.fillStyle = isEnded ? '#fca5a5' : '#6ee7b7';
    ctx.font = '28px "Plus Jakarta Sans", sans-serif';

    if (isEnded) {
      ctx.fillText('Call Ended', 210, 146);
    } else if (this.callLastExpandedState === 'active_call') {
      const elapsedSec = Math.floor((performance.now() - this.callConnectedTime) / 1000);
      const min = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const sec = String(elapsedSec % 60).padStart(2, '0');
      ctx.fillText(`In Call • ${min}:${sec}`, 210, 146);
    } else {
      ctx.fillText('Incoming Call...', 210, 146);
    }

    clearTextShadow();
    this.callPillTexture.needsUpdate = true;
  }

  public renderCallCardCanvas() {
    const ctx = this.callCardCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.callCardCanvas.width, this.callCardCanvas.height);
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const payload = this.callPayload || {
      type: 'call' as NotificationType,
      title: 'Alex Wong',
      subtitle: 'Incoming Call',
      body: 'Incoming Call',
      avatarText: 'AW'
    };

    const applyTextShadow = () => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    };
    const clearTextShadow = () => {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    };

    // C. Active Call Screen
    if (this.callState === 'active_call') {
      const w = 912;
      const h = 608;
      this.drawFrostedGlassPanel(ctx, 12, 12, w - 24, h - 24, 32, 'rgba(255, 255, 255, 0.28)');

      // Caller Avatar
      ctx.fillStyle = payload.avatarColor || 'rgba(16, 185, 129, 0.70)';
      ctx.beginPath();
      ctx.arc(w / 2, 130, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 3;
      ctx.stroke();

      applyTextShadow();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(payload.avatarText, w / 2, 130);

      ctx.font = 'bold 40px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(payload.title, w / 2, 222);

      // Live Timer
      const elapsedSec = Math.floor((performance.now() - this.callConnectedTime) / 1000);
      const min = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const sec = String(elapsedSec % 60).padStart(2, '0');

      ctx.fillStyle = '#6ee7b7';
      ctx.font = 'bold 32px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`${min}:${sec}`, w / 2, 272);

      // Centered End Call Button (Pure UI: natural red gaze glow ring, no tutorial text!)
      const endBtnY = 440;
      const isFocused = this.isLookingAtEndCallButton;

      ctx.save();
      if (isFocused) {
        ctx.shadowColor = 'rgba(239, 68, 68, 0.95)';
        ctx.shadowBlur = 36;
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(w / 2, endBtnY, 70, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isFocused ? 'rgba(239, 68, 68, 0.95)' : 'rgba(239, 68, 68, 0.82)';
      ctx.beginPath();
      ctx.arc(w / 2, endBtnY, isFocused ? 60 : 56, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isFocused ? '#fecaca' : 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = isFocused ? 4 : 2.5;
      ctx.stroke();
      ctx.restore();

      drawIcon(ctx, ICONS['phone-off'], w / 2, endBtnY - 4, 32, '#ffffff', 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('End Call', w / 2, endBtnY + 32);

      clearTextShadow();
      this.callCardTexture.needsUpdate = true;
      return;
    }

    // B. Incoming Call Screen
    const w = 912;
    const h = 608;
    this.drawFrostedGlassPanel(ctx, 12, 12, w - 24, h - 24, 32, 'rgba(255, 255, 255, 0.28)');

    // Caller Avatar
    ctx.fillStyle = payload.avatarColor || 'rgba(16, 185, 129, 0.70)';
    ctx.beginPath();
    ctx.arc(w / 2, 140, 68, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();

    applyTextShadow();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 50px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(payload.avatarText, w / 2, 140);

    ctx.font = 'bold 44px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(payload.title, w / 2, 240);

    ctx.fillStyle = '#6ee7b7';
    ctx.font = '26px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Incoming Call...', w / 2, 285);
    clearTextShadow();

    // Call Actions
    const isDeclineFocused = this.focusedCallButton === 'decline';
    const isAcceptFocused = this.focusedCallButton === 'accept';

    // Decline Button (Left)
    const decX = 230;
    const decY = 460;
    const decR = isDeclineFocused ? 68 : 58;

    ctx.save();
    if (isDeclineFocused) {
      ctx.shadowColor = 'rgba(239, 68, 68, 0.95)';
      ctx.shadowBlur = 36;
      ctx.strokeStyle = '#fca5a5';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(decX, decY, decR + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = isDeclineFocused ? 'rgba(239, 68, 68, 0.95)' : 'rgba(239, 68, 68, 0.80)';
    ctx.beginPath();
    ctx.arc(decX, decY, decR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isDeclineFocused ? '#fecaca' : 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = isDeclineFocused ? 4 : 2.5;
    ctx.stroke();
    ctx.restore();

    drawIcon(ctx, ICONS['phone-off'], decX, decY - 4, 36, '#ffffff', 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Decline', decX, decY + 32);

    // Accept Button (Right)
    const accX = w - 230;
    const accY = 460;
    const accR = isAcceptFocused ? 68 : 58;

    ctx.save();
    if (isAcceptFocused) {
      ctx.shadowColor = 'rgba(34, 197, 94, 0.95)';
      ctx.shadowBlur = 36;
      ctx.strokeStyle = '#86efac';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(accX, accY, accR + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = isAcceptFocused ? 'rgba(34, 197, 94, 0.95)' : 'rgba(34, 197, 94, 0.80)';
    ctx.beginPath();
    ctx.arc(accX, accY, accR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isAcceptFocused ? '#bbf7d0' : 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = isAcceptFocused ? 4 : 2.5;
    ctx.stroke();
    ctx.restore();

    drawIcon(ctx, ICONS['phone'], accX, accY - 4, 36, '#ffffff', 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Accept', accX, accY + 32);

    clearTextShadow();
    this.callCardTexture.needsUpdate = true;
  }

  public renderCallCanvas() {
    this.renderCallPillCanvas();
    this.renderCallCardCanvas();
  }

  // ================= 3. RENDER PHONE BASIC STATUS STRIP =================
  public renderStatusCanvas() {
    const ctx = this.statusCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.statusCanvas.width, this.statusCanvas.height);

    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const w = 340;
    const h = 60;

    // Semi-translucent frosted glass capsule background
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.40)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.78)');
    grad.addColorStop(1, 'rgba(30, 41, 59, 0.65)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 26);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = this.isLookingAtStatusBar
      ? 'rgba(255, 255, 255, 0.70)'
      : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = this.isLookingAtStatusBar ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 26);
    ctx.stroke();

    // 1. LEFT: Battery icon & percentage
    const batX = 22;
    const batY = 22;
    const batW = 28;
    const batH = 15;

    // Battery outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(batX, batY, batW, batH, 4);
    ctx.stroke();

    // Battery positive terminal nub
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.roundRect(batX + batW + 1.5, batY + 4, 3, 7, [0, 2, 2, 0]);
    ctx.fill();

    // Battery fill level
    const fillW = Math.max(2, (batW - 4) * (this.phoneBatteryLevel / 100));
    ctx.fillStyle = this.phoneBatteryLevel <= 20 ? '#ef4444' : '#22c55e';
    ctx.beginPath();
    ctx.roundRect(batX + 2, batY + 2, fillW, batH - 4, 2);
    ctx.fill();

    // Battery text percentage
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 15px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${this.phoneBatteryLevel}%`, batX + batW + 9, h / 2);

    // 2. CENTER: Current Local Time
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    this.lastTimeStr = `${hours}:${minutes}`;

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Plus Jakarta Sans", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;
    ctx.fillText(this.lastTimeStr, w / 2, h / 2);
    ctx.shadowColor = 'transparent';

    // 3. RIGHT: Small Speaker (Mute / Unmute Toggle Button - User requested: icon only, no MUTE/RING text)
    const btnCenterX = 295;
    const btnCenterY = h / 2;
    const isMuted = this.isPhoneMuted;
    const isFocused = this.isLookingAtMuteButton;

    // Glowing halo when gaze-focused
    ctx.save();
    if (isFocused) {
      ctx.shadowColor = isMuted ? 'rgba(245, 158, 11, 0.95)' : 'rgba(56, 189, 248, 0.95)';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = isMuted ? '#fcd34d' : '#7dd3fc';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(btnCenterX, btnCenterY, 21, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Circular background for mute button (icon only)
    ctx.fillStyle = isMuted
      ? isFocused ? 'rgba(245, 158, 11, 0.38)' : 'rgba(245, 158, 11, 0.22)'
      : isFocused ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(btnCenterX, btnCenterY, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isMuted
      ? 'rgba(245, 158, 11, 0.85)'
      : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // Lucide volume icon
    const volIcon = isMuted ? ICONS['volume-x'] : ICONS['volume-2'];
    const volColor = isMuted ? '#fbbf24' : '#ffffff';
    drawIcon(ctx, volIcon, btnCenterX, btnCenterY, 18, volColor, 2);

    this.statusTexture.needsUpdate = true;
  }

  // ================= MAIN UPDATE LOOP =================
  public update(time: number, isLookingAtPhone: boolean, isLookingAtPPT = false) {
    this.isLookingAtPhone = isLookingAtPhone;
    this.isLookingAtPPT = isLookingAtPPT;
    const anchor = this.anchorPosition;
    // Desk surface level is defined by the calibration baseRing (anchor.y - 0.10m)
    const deskY = anchor.y - 0.10;

    // 0. Update Phone Basic Status Bar (docked right above desk level: deskY + 0.010m)
    const targetStatusPos = new THREE.Vector3(anchor.x, deskY + 0.010, anchor.z);
    this.statusGroup.position.lerp(targetStatusPos, 0.18);
    this.statusGroup.lookAt(this.xr.camera.position);

    // Live clock update: check once every minute
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    if (timeStr !== this.lastTimeStr && this.statusVisible) {
      this.renderStatusCanvas();
    }

    // 1. Ray distances for 3D spatial gaze discrimination
    const camPos = this.xr.getCameraPosition();
    const gazeDir = this.xr.getGazeDirection();
    const gazeRay = new THREE.Ray(camPos, gazeDir);

    const callActive = this.callState !== 'idle';
    const hasActiveSms = this.activeSmsList.length > 0;

    const distToStatus = gazeRay.distanceToPoint(this.statusGroup.position);
    let minCardDist = 999;
    for (const item of this.activeSmsList) {
      const d = gazeRay.distanceToPoint(item.group.position);
      if (d < minCardDist) minCardDist = d;
    }
    if (callActive) {
      const d = gazeRay.distanceToPoint(this.callGroup.position);
      if (d < minCardDist) minCardDist = d;
    }
    const isCloserToCard = (hasActiveSms || callActive) && minCardDist < distToStatus;

    // Status Bar Gaze Focus & Subtle Scaling Animation
    // When gazing directly at the status bar without active cards, subtly scale to acknowledge focus.
    // CRITICAL: Status bar focus must NEVER trigger if user is looking at an active notification card!
    let isFocusedOnStatusBar = false;
    if (this.statusVisible && isLookingAtPhone && !isCloserToCard) {
      const statusCoords = this.getGazeCanvasCoords(
        this.statusGroup,
        this.statusWidth,
        this.statusHeight,
        340,
        60,
        0.008
      );
      isFocusedOnStatusBar = statusCoords !== null && distToStatus < minCardDist;
    }

    // Dwell check to eliminate momentary eye sweeps when glancing down at keyboard
    if (isFocusedOnStatusBar) {
      if (this.statusBarGazeStartTime === 0) {
        this.statusBarGazeStartTime = performance.now();
      }
      const statusDwell = (performance.now() - this.statusBarGazeStartTime) / 1000;
      if (statusDwell >= 0.10) {
        if (!this.isLookingAtStatusBar) {
          this.isLookingAtStatusBar = true;
          this.renderStatusCanvas();

          // CRITICAL: When looking at status bar, collapse other expanded panels
          // BUT NEVER collapse reply_active! In reply_active, user is typing on keyboard!
          for (const item of this.activeSmsList) {
            if (item.state === 'expanded_card') {
              item.lastExpandedState = 'expanded_card';
              this.switchSmsState('peripheral_pill', item);
            }
          }
          if (this.callState === 'expanded_card' || this.callState === 'active_call') {
            this.callLastExpandedState = this.callState;
            this.switchCallState('peripheral_pill');
          }
          this.phoneGazeStartTime = 0;
          this.activeFocusedChannel = null;
        }
      }
    } else {
      this.statusBarGazeStartTime = 0;
      if (this.isLookingAtStatusBar) {
        this.isLookingAtStatusBar = false;
        this.renderStatusCanvas();
      }
    }

    // Smooth status scale animation: 1.08x when gazed at, 1.0 when not
    const targetStatusScale = this.isLookingAtStatusBar ? 1.08 : 1.0;
    this.statusScaleAnim += (targetStatusScale - this.statusScaleAnim) * 0.20;
    this.statusMesh.scale.set(this.statusScaleAnim, this.statusScaleAnim, 1);

    // 2. Vertical Spatial Stacking for Coexisting Cards grounded to desk level (deskY)
    interface ActiveCardItem {
      channel: string;
      group: THREE.Group;
      height: number;
      receivedTime: number;
      targetPos: THREE.Vector3;
      riseActive: boolean;
      smsRef?: SmsItem;
    }

    const activeCards: ActiveCardItem[] = [];
    for (const item of this.activeSmsList) {
      activeCards.push({
        channel: item.id,
        group: item.group,
        height: item.height,
        receivedTime: item.receivedTime,
        targetPos: new THREE.Vector3().copy(anchor),
        riseActive: item.riseActive,
        smsRef: item
      });
    }
    if (callActive) {
      activeCards.push({
        channel: 'call',
        group: this.callGroup,
        height: this.callHeight,
        receivedTime: this.callReceivedTime,
        targetPos: new THREE.Vector3().copy(anchor),
        riseActive: this.callRiseActive
      });
    }

    // Deterministic slotting strictly by arrival timestamp: oldest at bottom, newest is UPPER
    activeCards.sort((a, b) => a.receivedTime - b.receivedTime);

    let stackBaseY = deskY + 0.088;
    const stackGap = 0.038;
    for (let i = 0; i < activeCards.length; i++) {
      const card = activeCards[i];
      const targetY = stackBaseY + (card.height / 2);
      card.targetPos.y = targetY;
      stackBaseY = targetY + (card.height / 2) + stackGap;

      // Stacking order: higher/newer cards render in front (renderOrder 20 + i)
      const baseOrder = 20 + i;
      card.group.renderOrder = baseOrder;
      if (card.smsRef) {
        const order = card.smsRef.state === 'reply_active' ? 35 : baseOrder;
        card.smsRef.pillMesh.renderOrder = order;
        card.smsRef.cardMesh.renderOrder = order;
        card.group.renderOrder = order;
      } else if (card.channel === 'call') {
        this.callPillMesh.renderOrder = baseOrder + 5;
        this.callCardMesh.renderOrder = baseOrder + 5;
        this.callGroup.renderOrder = baseOrder + 5;
      }

      // Smooth position lerp — slower during initial rise for the "floating up" effect
      const lerpSpeed = card.riseActive ? 0.055 : 0.18;
      card.group.position.lerp(card.targetPos, lerpSpeed);

      // Billboarding facing camera
      card.group.lookAt(this.xr.camera.position);

      // Deactivate rise flag once the bubble has nearly reached its target Y
      if (card.riseActive && Math.abs(card.group.position.y - card.targetPos.y) < 0.005) {
        if (card.smsRef) {
          card.smsRef.riseActive = false;
        } else if (card.channel === 'call') {
          this.callRiseActive = false;
        }
      }
    }

    // 3. Head Gaze State Machine with Generous Deadband Hysteresis
    // Evaluates whenever looking at phone anchor OR looking directly at any card in the stack (including high cards 3–7)!
    const isLookingDirectlyAtCard = (hasActiveSms || callActive) && minCardDist < 0.22;
    const isGazingAtCardStack = isLookingAtPhone || isLookingDirectlyAtCard;

    if (isGazingAtCardStack && !this.isLookingAtStatusBar) {
      this.gazeLeaveTimestamp = 0;

      // Determine which notification card user is looking at
      const activeList: { channel: string; dist: number }[] = [];
      for (const item of this.activeSmsList) {
        activeList.push({ channel: item.id, dist: gazeRay.distanceToPoint(item.group.position) });
      }
      if (callActive) {
        activeList.push({ channel: 'call', dist: gazeRay.distanceToPoint(this.callGroup.position) });
      }

      if (activeList.length > 0) {
        activeList.sort((a, b) => a.dist - b.dist);
        const closest = activeList[0];

        // 4cm deadband hysteresis prevents jitter or flip-flopping between cards
        if (this.activeFocusedChannel && this.activeFocusedChannel !== closest.channel) {
          let currentDist = 999;
          if (this.activeFocusedChannel === 'call') {
            currentDist = gazeRay.distanceToPoint(this.callGroup.position);
          } else {
            const currentItem = this.activeSmsList.find(i => i.id === this.activeFocusedChannel);
            if (currentItem) {
              currentDist = gazeRay.distanceToPoint(currentItem.group.position);
            }
          }
          if (closest.dist < currentDist - 0.04) {
            this.activeFocusedChannel = closest.channel;
            this.phoneGazeStartTime = performance.now();
          }
        } else if (!this.activeFocusedChannel) {
          this.activeFocusedChannel = closest.channel;
          this.phoneGazeStartTime = performance.now();
        }
      }

      // Dwell expansion on focused channel
      if (this.phoneGazeStartTime === 0) {
        this.phoneGazeStartTime = performance.now();
      }
      const dwellTime = (performance.now() - this.phoneGazeStartTime) / 1000;

      if (dwellTime >= this.GAZE_EXPAND_DWELL_SEC) {
        if (this.activeFocusedChannel === 'call' && this.callState === 'peripheral_pill') {
          audioManager.playPinchClick();
          this.switchCallState(this.callLastExpandedState || 'expanded_card');
          for (const item of this.activeSmsList) {
            if (item.state === 'expanded_card' || item.state === 'reply_active') {
              item.lastExpandedState = item.state;
              this.switchSmsState('peripheral_pill', item);
            }
          }
        } else if (this.activeFocusedChannel?.startsWith('sms-')) {
          const focusedItem = this.activeSmsList.find(i => i.id === this.activeFocusedChannel);
          if (focusedItem && focusedItem.state === 'peripheral_pill') {
            audioManager.playPinchClick();
            this.switchSmsState(focusedItem.lastExpandedState || 'expanded_card', focusedItem);
            for (const other of this.activeSmsList) {
              if (other !== focusedItem && (other.state === 'expanded_card' || other.state === 'reply_active')) {
                other.lastExpandedState = other.state;
                this.switchSmsState('peripheral_pill', other);
              }
            }
            if (callActive && (this.callState === 'expanded_card' || this.callState === 'active_call')) {
              this.callLastExpandedState = this.callState;
              this.switchCallState('peripheral_pill');
            }
          }
        }
      }
    } else if (!isGazingAtCardStack) {
      // User looking away towards PPT/workspace
      this.phoneGazeStartTime = 0;
      if (this.gazeLeaveTimestamp === 0) {
        this.gazeLeaveTimestamp = performance.now();
      }
      const awayDwell = (performance.now() - this.gazeLeaveTimestamp) / 1000;

      // Keep card open while actively composing a reply; only collapse when in passive expanded_card state.
      // DO NOT collapse when in reply_active! Only collapse expanded_card!
      if (awayDwell >= this.COLLAPSE_DELAY_SEC) {
        for (const item of this.activeSmsList) {
          if (item.state === 'expanded_card') {
            item.lastExpandedState = item.state;
            this.switchSmsState('peripheral_pill', item);
          }
        }
        if (this.callState === 'expanded_card' || this.callState === 'active_call') {
          this.callLastExpandedState = this.callState;
          this.switchCallState('peripheral_pill');
        }
      }
    }

    // 3. Relaxed & Comfortable Button Gaze Tracking with Strict Mutual Exclusivity
    // Enforce single-item focus so the user only ever hovers/commits one button at a time.
    if (isGazingAtCardStack) {
      const camPos = this.xr.getCameraPosition();
      const gazeDir = this.xr.getGazeDirection();
      const gazeRay = new THREE.Ray(camPos, gazeDir);

      interface ButtonCandidate {
        id: string;
        dist: number;
        type: 'sms_close' | 'sms_send' | 'sms_input' | 'phone_mute' | 'call_accept' | 'call_decline' | 'call_end';
        smsItem?: SmsItem;
      }
      const candidates: ButtonCandidate[] = [];

      // A. SMS Panel Buttons (Close Button, Send Button, Input Bar) across all active SMS
      for (const item of this.activeSmsList) {
        if (item.state === 'expanded_card' || item.state === 'reply_active') {
          const smsLogicalW = 912;
          const smsLogicalH = 608;
          const smsCoords = this.getGazeCanvasCoords(
            item.group,
            item.width,
            item.height,
            smsLogicalW,
            smsLogicalH
          );

          if (smsCoords) {
            // 1. Close Button (top-right corner: generous head-gaze hit zone)
            if (smsCoords.px >= 680 && smsCoords.px <= 920 && smsCoords.py >= 0 && smsCoords.py <= 140) {
              const localX = (858 / smsLogicalW - 0.5) * item.width;
              const localY = (0.5 - 64 / smsLogicalH) * item.height;
              const worldPos = item.group.localToWorld(new THREE.Vector3(localX, localY, 0));
              candidates.push({ id: `${item.id}_close`, dist: gazeRay.distanceToPoint(worldPos), type: 'sms_close', smsItem: item });
            }

            // 2. Input Bar in expanded_card (generous lower-half card zone for head gaze)
            if (item.state === 'expanded_card') {
              if (smsCoords.px >= 0 && smsCoords.px <= 912 && smsCoords.py >= 360 && smsCoords.py <= 608) {
                const localX = 0;
                const localY = (0.5 - 553 / smsLogicalH) * item.height;
                const worldPos = item.group.localToWorld(new THREE.Vector3(localX, localY, 0));
                candidates.push({ id: `${item.id}_input`, dist: gazeRay.distanceToPoint(worldPos), type: 'sms_input', smsItem: item });
              }
            }

            // 3. Send Button (bottom-right quadrant of reply panel: generous head-gaze zone)
            if (item.state === 'reply_active') {
              if (smsCoords.px >= 640 && smsCoords.px <= 920 && smsCoords.py >= 400 && smsCoords.py <= 608) {
                const localX = (824 / 912 - 0.5) * item.width;
                const localY = (0.5 - 546 / smsLogicalH) * item.height;
                const worldPos = item.group.localToWorld(new THREE.Vector3(localX, localY, 0));
                candidates.push({ id: `${item.id}_send`, dist: gazeRay.distanceToPoint(worldPos), type: 'sms_send', smsItem: item });
              }
            }
          }
        }
      }

      // B. Phone Status Bar: Mute / Ring Toggle Button (entire right side for head gaze)
      if (this.statusVisible && !isCloserToCard) {
        const statusCoords = this.getGazeCanvasCoords(
          this.statusGroup,
          this.statusWidth,
          this.statusHeight,
          340,
          60,
          0.008
        );
        // Right side zone of status bar (speaker toggle centered at 295, 30)
        if (statusCoords && statusCoords.px >= 180 && statusCoords.px <= 350 && statusCoords.py >= -15 && statusCoords.py <= 75) {
          const localX = (295 / 340 - 0.5) * this.statusWidth;
          const localY = (0.5 - 30 / 60) * this.statusHeight;
          const worldPos = this.statusGroup.localToWorld(new THREE.Vector3(localX, localY, 0));
          candidates.push({ id: 'phone_mute', dist: gazeRay.distanceToPoint(worldPos), type: 'phone_mute' });
        }
      }

      // C. Call Card Buttons (generous halves for head gaze)
      if (this.callState === 'expanded_card' || this.callState === 'active_call') {
        const callLogicalW = 912;
        const callLogicalH = 608;
        const callCoords = this.getGazeCanvasCoords(
          this.callGroup,
          this.callWidth,
          this.callHeight,
          callLogicalW,
          callLogicalH
        );

        if (callCoords) {
          if (this.callState === 'expanded_card' && callCoords.py >= 260) {
            if (callCoords.px < 456) {
              // Decline button (left half)
              const localX = (230 / callLogicalW - 0.5) * this.callWidth;
              const localY = (0.5 - 460 / callLogicalH) * this.callHeight;
              const worldPos = this.callGroup.localToWorld(new THREE.Vector3(localX, localY, 0));
              candidates.push({ id: 'call_decline', dist: gazeRay.distanceToPoint(worldPos), type: 'call_decline' });
            } else {
              // Accept button (right half)
              const localX = (682 / callLogicalW - 0.5) * this.callWidth;
              const localY = (0.5 - 460 / callLogicalH) * this.callHeight;
              const worldPos = this.callGroup.localToWorld(new THREE.Vector3(localX, localY, 0));
              candidates.push({ id: 'call_accept', dist: gazeRay.distanceToPoint(worldPos), type: 'call_accept' });
            }
          } else if (this.callState === 'active_call') {
            if (callCoords.py >= 240 && callCoords.px >= 100 && callCoords.px <= 812) {
              // End Call button (generous bottom area)
              const localX = 0;
              const localY = (0.5 - 440 / callLogicalH) * this.callHeight;
              const worldPos = this.callGroup.localToWorld(new THREE.Vector3(localX, localY, 0));
              candidates.push({ id: 'call_end', dist: gazeRay.distanceToPoint(worldPos), type: 'call_end' });
            }
          }
        }
      }

      // STRICT MUTUAL EXCLUSIVITY: Exactly ONE candidate with minimum gaze distance wins!
      let winner: ButtonCandidate | null = null;
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.dist - b.dist);
        winner = candidates[0];
      }

      for (const item of this.activeSmsList) {
        const nextClose = winner !== null && winner.id === `${item.id}_close`;
        const nextSend = winner !== null && winner.id === `${item.id}_send`;
        const nextInput = winner !== null && winner.id === `${item.id}_input`;

        if (
          nextClose !== item.isLookingAtCloseButton ||
          nextSend !== item.isLookingAtSendButton ||
          nextInput !== item.isLookingAtInputBar
        ) {
          if (nextClose !== item.isLookingAtCloseButton) {
            item.replyBgDirty = true;
          }
          item.isLookingAtCloseButton = nextClose;
          item.isLookingAtSendButton = nextSend;
          item.isLookingAtInputBar = nextInput;
          this.renderSmsCardCanvas(item);
        }
      }

      const nextLookingAtMute = winner !== null && winner.id === 'phone_mute';
      if (nextLookingAtMute !== this.isLookingAtMuteButton) {
        this.isLookingAtMuteButton = nextLookingAtMute;
        this.renderStatusCanvas();
      }

      const nextFocusedCallButton = winner?.type === 'call_accept' ? 'accept' : (winner?.type === 'call_decline' ? 'decline' : null);
      const nextLookingAtEndCall = winner?.type === 'call_end';
      if (
        nextFocusedCallButton !== this.focusedCallButton ||
        nextLookingAtEndCall !== this.isLookingAtEndCallButton
      ) {
        this.focusedCallButton = nextFocusedCallButton;
        this.isLookingAtEndCallButton = nextLookingAtEndCall;
        this.renderCallCanvas();
      }
    } else {
      // User looking away: reset all button hover glow states cleanly
      for (const item of this.activeSmsList) {
        if (item.isLookingAtCloseButton || item.isLookingAtSendButton || item.isLookingAtInputBar) {
          if (item.isLookingAtCloseButton) {
            item.replyBgDirty = true;
          }
          item.isLookingAtCloseButton = false;
          item.isLookingAtSendButton = false;
          item.isLookingAtInputBar = false;
          this.renderSmsCardCanvas(item);
        }
      }
      if (this.isLookingAtMuteButton) {
        this.isLookingAtMuteButton = false;
        this.renderStatusCanvas();
      }
      if (this.focusedCallButton !== null || this.isLookingAtEndCallButton) {
        this.focusedCallButton = null;
        this.isLookingAtEndCallButton = false;
        this.renderCallCanvas();
      }
    }

    // 4. Live timers & Cursor Blink
    if (this.callState === 'active_call') {
      this.renderCallCanvas();
    }

    const hasAnyReplyActive = this.activeSmsList.some(item => item.state === 'reply_active');
    if (hasAnyReplyActive) {
      if (time - this.lastBlinkTime > 0.5) {
        this.cursorBlink = !this.cursorBlink;
        this.lastBlinkTime = time;
        for (const item of this.activeSmsList) {
          if (item.state === 'reply_active') {
            this.renderSmsCardCanvas(item);
          }
        }
      }
    }

    // 5. Fluid Morphing Animation for Expand & Collapse
    // Snappy, lively ~200ms ease-out transition
    const morphSpeed = 0.14;
    for (const item of this.smsPool) {
      if (item.state === 'idle' && item.opacity <= 0.01) {
        item.group.visible = false;
        item.pillMesh.visible = false;
        item.cardMesh.visible = false;
        continue;
      }
      item.animProgress += (item.targetProgress - item.animProgress) * morphSpeed;
      const t = Math.max(0, Math.min(1, item.animProgress));
      const curW = THREE.MathUtils.lerp(0.20, 0.24, t);
      const curH = THREE.MathUtils.lerp(0.056, 0.16, t);
      item.width = curW;
      item.height = curH;

      item.pillMesh.scale.set(curW / 0.20, curH / 0.056, 1);
      item.cardMesh.scale.set(curW / 0.24, curH / 0.16, 1);

      const pillAlpha = Math.max(0, Math.min(1, (0.40 - t) / 0.40));
      const cardAlpha = Math.max(0, Math.min(1, (t - 0.20) / 0.80));

      item.opacity += (item.targetOpacity - item.opacity) * 0.18;

      let riseAlpha = 1.0;
      if (item.riseActive) {
        const cardEntry = activeCards.find(c => c.channel === item.id);
        const targetY = cardEntry ? cardEntry.targetPos.y : (deskY + 0.15);
        const riseFraction = Math.max(0, Math.min(1, (item.group.position.y - deskY) / Math.max(0.01, targetY - deskY)));
        const scaleVal = 0.70 + 0.30 * (1 - Math.pow(1 - riseFraction, 2));
        item.group.scale.set(scaleVal, scaleVal, scaleVal);
        riseAlpha = Math.min(1, Math.max(0.12, riseFraction * 1.4));
      } else {
        item.group.scale.set(1, 1, 1);
      }

      (item.pillMesh.material as THREE.MeshBasicMaterial).opacity = pillAlpha * item.opacity * riseAlpha;
      (item.cardMesh.material as THREE.MeshBasicMaterial).opacity = cardAlpha * item.opacity * riseAlpha;

      item.pillMesh.visible = item.state !== 'idle' && pillAlpha > 0.01 && item.opacity > 0.01;
      item.cardMesh.visible = item.state !== 'idle' && cardAlpha > 0.01 && item.opacity > 0.01;
      item.group.visible = item.state !== 'idle' && item.opacity > 0.01;

      // Levitation pulse for settled pills
      if (item.state === 'peripheral_pill' && !item.hasReplied && item.animProgress < 0.05) {
        const offsetIndex = parseInt(item.id.replace('sms-', ''), 10) || 0;
        item.pillMesh.position.y = Math.sin(time * 4 + offsetIndex * 0.5) * 0.005;
      } else {
        item.pillMesh.position.y = 0;
      }
    }

    // Call Continuous Dimension & Crossfade Morphing
    this.callAnimProgress += (this.callTargetProgress - this.callAnimProgress) * morphSpeed;
    const tCall = Math.max(0, Math.min(1, this.callAnimProgress));
    const currentCallW = THREE.MathUtils.lerp(0.20, 0.24, tCall);
    const currentCallH = THREE.MathUtils.lerp(0.056, 0.16, tCall);
    this.callWidth = currentCallW;
    this.callHeight = currentCallH;

    this.callPillMesh.scale.set(currentCallW / 0.20, currentCallH / 0.056, 1);
    this.callCardMesh.scale.set(currentCallW / 0.24, currentCallH / 0.16, 1);

    const callPillAlpha = Math.max(0, Math.min(1, (0.40 - tCall) / 0.40));
    const callCardAlpha = Math.max(0, Math.min(1, (tCall - 0.20) / 0.80));

    this.callOpacity += (this.callTargetOpacity - this.callOpacity) * 0.18;

    let callRiseAlpha = 1.0;
    if (this.callRiseActive) {
      const callEntry = activeCards.find(c => c.channel === 'call');
      const targetY = callEntry ? callEntry.targetPos.y : (deskY + 0.15);
      const riseFraction = Math.max(0, Math.min(1, (this.callGroup.position.y - deskY) / Math.max(0.01, targetY - deskY)));
      const scaleVal = 0.70 + 0.30 * (1 - Math.pow(1 - riseFraction, 2));
      this.callGroup.scale.set(scaleVal, scaleVal, scaleVal);
      callRiseAlpha = Math.min(1, Math.max(0.12, riseFraction * 1.4));
    } else {
      this.callGroup.scale.set(1, 1, 1);
    }

    (this.callPillMesh.material as THREE.MeshBasicMaterial).opacity = callPillAlpha * this.callOpacity * callRiseAlpha;
    (this.callCardMesh.material as THREE.MeshBasicMaterial).opacity = callCardAlpha * this.callOpacity * callRiseAlpha;

    this.callPillMesh.visible = this.callState !== 'idle' && callPillAlpha > 0.01 && this.callOpacity > 0.01;
    this.callCardMesh.visible = this.callState !== 'idle' && callCardAlpha > 0.01 && this.callOpacity > 0.01;

    // Levitation pulse for settled Call pill
    if (
      this.callState === 'peripheral_pill' &&
      (this.callLastExpandedState === 'active_call' || this.callConnectedTime > 0 || this.callPayload !== null) &&
      this.callAnimProgress < 0.05
    ) {
      this.callPillMesh.position.y = Math.sin(time * 4 + 1) * 0.005;
    } else {
      this.callPillMesh.position.y = 0;
    }
  }
}
