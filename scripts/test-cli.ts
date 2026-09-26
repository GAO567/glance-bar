/**
 * GlanceBar Automated CLI Test Suite
 * Validates spatial gaze math, contact uniqueness, switch button precision, and typing speed.
 */
import * as THREE from 'three';

// 1. Minimal Headless DOM Polyfill for Node.js
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

if (typeof (globalThis as any).document === 'undefined') {
  const dummyCtx: any = {
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    rotate: () => {},
    closePath: () => {},
    clip: () => {},
    bezierCurveTo: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    fillRect: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
  };

  const dummyCanvas = () => ({
    width: 2048,
    height: 1216,
    getContext: () => dummyCtx,
    style: {}
  });

  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return dummyCanvas();
      return { style: {}, addEventListener: () => {} };
    },
    createElementNS: (_ns: string, tag: string) => {
      if (tag === 'canvas') return dummyCanvas();
      return { style: {}, addEventListener: () => {}, setAttribute: () => {} };
    },
    getElementById: () => ({ style: {}, addEventListener: () => {} }),
  };

  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class {
      constructor(_p?: any) {}
    };
  }

  if (typeof (globalThis as any).AudioContext === 'undefined') {
    (globalThis as any).AudioContext = class {
      createOscillator = () => ({
        connect: () => {},
        start: () => {},
        stop: () => {},
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {}
        }
      });
      createGain = () => ({ connect: () => {}, gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } });
      destination = {};
      currentTime = 0;
      state = 'running';
      resume = async () => {};
    };
  }
}

function createMockXRManager(): any {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(0, 1.20, 0);

  const mockRenderer: any = {
    capabilities: {
      getMaxAnisotropy: () => 1
    },
    xr: {
      isPresenting: true,
      getCamera: () => camera
    }
  };

  return {
    scene,
    camera,
    renderer: mockRenderer,
    getCameraPosition: (target = new THREE.Vector3()) => {
      camera.getWorldPosition(target);
      return target;
    },
    getGazeDirection: (target = new THREE.Vector3()) => {
      camera.getWorldDirection(target);
      return target;
    },
    onPinchStart: null,
    onPinchMove: null,
    onPinchEnd: null,
    onSelect: null
  };
}

// 2. Import System Classes
import { PeripheralGazeSystem } from '../src/systems/PeripheralGazeSystem.ts';
import { WorkspaceSystem } from '../src/systems/WorkspaceSystem.ts';
import { NotificationSystem } from '../src/systems/NotificationSystem.ts';
import { SimulationMenu } from '../src/ui/SimulationMenu.ts';
import { SurfaceKeyboardSystem } from '../src/systems/SurfaceKeyboardSystem.ts';
import { XRManager } from '../src/core/XRManager.ts';

async function runCliTests() {
  console.log('====================================================');
  console.log('🧪 Starting GlanceBar Automated WebXR CLI Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  // Setup Systems
  const xr = createMockXRManager();
  const phonePos = new THREE.Vector3(0.28, 0.74, -0.45);
  const pptPos = new THREE.Vector3(0, 1.16, -1.15);

  const gazeSys = new PeripheralGazeSystem(xr, phonePos, pptPos);
  const workspaceSys = new WorkspaceSystem(xr, pptPos);
  const notificationSys = new NotificationSystem(xr, phonePos);
  const simulationMenu = new SimulationMenu(xr, notificationSys);
  const keyboardSys = new SurfaceKeyboardSystem(xr, notificationSys, phonePos);

  // Set user eye height to 1.20m seated
  xr.camera.position.set(0, 1.20, 0);

  // --------------------------------------------------------------------------
  console.log('Test Suite 1: Gaze Detection & High-Bubble Focus Fix');
  // --------------------------------------------------------------------------
  {
    // A. Looking forward at PPT
    xr.camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
    let status = gazeSys.update();
    assert('Gaze at center PPT recognizes isLookingAtPPT', status.isLookingAtPPT === true);
    assert('Gaze at center PPT does not false-trigger isLookingAtPhone', status.isLookingAtPhone === false);

    // B. Looking at Desk Phone Anchor (Desk level Y = 0.74)
    xr.camera.lookAt(phonePos);
    status = gazeSys.update();
    assert('Gaze directly at Desk Phone triggers isLookingAtPhone', status.isLookingAtPhone === true);

    // C. Looking at High Notification Bubble (Bubble #6 stacked up to Y = 1.35m)
    const highBubblePos = new THREE.Vector3(phonePos.x, phonePos.y + 0.60, phonePos.z);
    xr.camera.lookAt(highBubblePos);
    status = gazeSys.update();
    assert(
      'Gaze at high-stacked bubble (#6 at +0.60m) maintains isLookingAtPhone focus',
      status.isLookingAtPhone === true,
      `Current minStackAngle: ${gazeSys.currentAngle}°`
    );
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 2: Notification Contacts Deduplication');
  // --------------------------------------------------------------------------
  {
    // Trigger 8 random SMS notifications
    for (let i = 0; i < 8; i++) {
      notificationSys.triggerRandomSMS();
    }

    assert('Active SMS list contains exactly 8 bubbles', notificationSys.activeSmsList.length === 8);

    const senders = notificationSys.activeSmsList.map(s => s.payload?.title);
    const uniqueSenders = new Set(senders);
    assert(
      'All 8 concurrently displayed bubbles have unique senders (no duplicates)',
      uniqueSenders.size === 8,
      `Displayed senders: [${senders.join(', ')}]`
    );
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 3: Workspace Switch Button Precision (No False Triggers)');
  // --------------------------------------------------------------------------
  {
    // A. Looking at the right half of the PPT (where text/tables are)
    // Ray aimed at X = +0.25m, Y = 1.16m on PPT
    xr.camera.lookAt(new THREE.Vector3(0.25, 1.16, -1.15));
    workspaceSys.update(0);
    assert(
      'Reading right side of PPT (X=+0.25m) DOES NOT select switch button',
      workspaceSys.isLookingAtSwitchIcon === false
    );

    // B. Looking directly at the top-right switch button icon (X ≈ +0.45m, Y ≈ +1.40m)
    const buttonWorldPos = workspaceSys.switchButtonMesh.getWorldPosition(new THREE.Vector3());
    xr.camera.lookAt(buttonWorldPos);
    workspaceSys.update(0);
    assert(
      'Looking directly at corner switch button selects isLookingAtSwitchIcon',
      workspaceSys.isLookingAtSwitchIcon === true
    );

    // C. Swap windows on trackpad tap
    const initialDoc = workspaceSys.activeDoc;
    workspaceSys.swapWindows();
    assert(
      'swapWindows toggles front document between PPT and Word',
      workspaceSys.activeDoc !== initialDoc
    );
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 4: Simulation Menu Gaze Hover & Auto Selection');
  // --------------------------------------------------------------------------
  {
    simulationMenu.setVisible(true);

    // Looking directly at the menu panel
    const menuCenter = simulationMenu.expandedMesh.getWorldPosition(new THREE.Vector3());
    xr.camera.lookAt(menuCenter);
    simulationMenu.update(0);

    assert(
      'Gaze raycasting detects hovered button on Simulation Menu without cursor dot',
      simulationMenu.isGazeHovered() === true
    );

    // Test minimize
    simulationMenu.minimize();
    assert('Menu successfully collapses to single circular icon', simulationMenu.isMinimized === true);

    simulationMenu.maximize();
    assert('Menu expands back to full action panel', simulationMenu.isMinimized === false);
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 5: Surface Keyboard High-Speed Typing Latency');
  // --------------------------------------------------------------------------
  {
    // Enter reply mode
    const item = notificationSys.activeSmsList[0];
    notificationSys.switchSmsState('reply_active', item);

    assert('Notification is in reply_active mode', notificationSys.isReplyActive() === true);

    const testString = 'Hello Meta Quest!';
    const t0 = performance.now();

    for (const char of testString) {
      keyboardSys.handleKeyPress({
        id: char,
        label: char,
        char: char,
        x: 100,
        y: 100,
        w: 80,
        h: 80
      });
    }

    const tTotal = performance.now() - t0;
    const avgPerKey = tTotal / testString.length;

    assert(
      `Typed "${testString}" with replyText matching`,
      notificationSys.replyText === testString,
      `Actual replyText: "${notificationSys.replyText}"`
    );

    assert(
      `Ultra-fast typing latency: total ${tTotal.toFixed(2)}ms (${avgPerKey.toFixed(3)}ms/key < 1.0ms)`,
      avgPerKey < 1.0,
      `Average latency: ${avgPerKey.toFixed(3)}ms`
    );
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 6: XRManager Hand Tracking Pinch Precision & Anti-Chatter (Fix Verification)');
  // --------------------------------------------------------------------------
  {
    const xrHandTracker = Object.create(XRManager.prototype) as any;
    xrHandTracker.isRightPinching = false;
    xrHandTracker.isLeftPinching = false;
    xrHandTracker.lastPinchStartTime = -1000;
    xrHandTracker.PINCH_ENTER_DIST = 0.018; // 1.8cm
    xrHandTracker.PINCH_EXIT_DIST = 0.028;  // 2.8cm
    xrHandTracker.PINCH_DEBOUNCE_MS = 280;  // 280ms

    let pinchStartCount = 0;
    let pinchMoveCount = 0;
    let pinchEndCount = 0;

    xrHandTracker.onPinchStart = () => {
      pinchStartCount++;
    };
    xrHandTracker.onPinchMove = () => {
      pinchMoveCount++;
    };
    xrHandTracker.onPinchEnd = () => {
      pinchEndCount++;
    };

    function sendHandJoints(
      handedness: 'left' | 'right',
      idxPos: THREE.Vector3,
      thmPos: THREE.Vector3
    ) {
      const mockHand = new Map();
      mockHand.set('index-finger-tip', 'joint-idx');
      mockHand.set('thumb-tip', 'joint-thm');

      const mockRefSpace = {};
      const mockSession = {
        inputSources: [
          {
            handedness,
            hand: mockHand
          }
        ]
      };

      const mockFrame: any = {
        getJointPose: (joint: string) => {
          const pos = joint === 'joint-idx' ? idxPos : thmPos;
          return {
            transform: {
              position: { x: pos.x, y: pos.y, z: pos.z }
            }
          };
        }
      };

      xrHandTracker.xrSession = mockSession;
      xrHandTracker.refSpace = mockRefSpace;
      xrHandTracker.updateHands(mockFrame);
    }

    // 1. Initial State: Fingers wide apart (4cm)
    const widePosIdx = new THREE.Vector3(0, 1.0, 0);
    const widePosThm = new THREE.Vector3(0.040, 1.0, 0);
    sendHandJoints('right', widePosIdx, widePosThm);

    assert('Initial open hand distance (4.0cm) does not pinch', pinchStartCount === 0);

    // 2. Deliberate pinch contact (1.5cm < 1.8cm enter threshold)
    const pinchPosIdx = new THREE.Vector3(0, 1.0, 0);
    const pinchPosThm = new THREE.Vector3(0.015, 1.0, 0);
    sendHandJoints('right', pinchPosIdx, pinchPosThm);

    assert('Fingers touching at 1.5cm (< 1.8cm) triggers exactly 1 onPinchStart', pinchStartCount === 1);
    assert('State is marked as pinching', xrHandTracker.isRightPinching === true);

    // 3. Jitter Test: Optical tracking noise flutters distance across the old 2.0cm boundary!
    // Frame A: flutters to 2.1cm (previously this caused false release!)
    sendHandJoints('right', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.021, 1, 0));

    // Frame B: flutters back to 1.9cm (previously this caused 2nd onPinchStart!)
    sendHandJoints('right', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.019, 1, 0));

    // Frame C: flutters to 2.5cm (still < 2.8cm release boundary)
    sendHandJoints('right', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.025, 1, 0));

    assert(
      'Optical tracking jitter across 2.0cm boundary does NOT trigger extra onPinchStart (count = 1)',
      pinchStartCount === 1,
      `Actual start count: ${pinchStartCount}`
    );
    assert('Hysteresis holds pinch steady during optical flutter (0 false release)', pinchEndCount === 0);

    // 4. Intentional finger release (3.2cm > 2.8cm release boundary)
    sendHandJoints('right', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.032, 1, 0));

    assert('Opening fingers past 2.8cm triggers exactly 1 onPinchEnd', pinchEndCount === 1);
    assert('State is marked as not pinching', xrHandTracker.isRightPinching === false);

    // 5. Debounce Test: Immediate re-pinch within debounce cooldown window (< 280ms)
    sendHandJoints('right', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.015, 1, 0));

    assert('Rapid re-pinch within 280ms debounce window is suppressed (anti-multi-trigger)', pinchStartCount === 1);

    // 6. Left-Hand Exclusion Test
    sendHandJoints('left', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.012, 1, 0));
    assert('Left hand pinch is completely rejected (strict right-hand only)', pinchStartCount === 1);
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 7: Dual-Modality Action Commit & Desk Zone Guard Conflict Prevention');
  // --------------------------------------------------------------------------
  {
    // Clean up any lingering active SMS from previous test suites
    for (const item of notificationSys.activeSmsList) {
      notificationSys.switchSmsState('peripheral_pill', item);
    }
    (notificationSys as any).lastTrackpadClickTime = -1000;
    workspaceSys.isLookingAtSwitchIcon = false;

    // A. Desk Keyboard Proximity Guard Test
    // Desk position: X = -0.04, Y = 0.743 (desk surface), Z = -0.38
    const deskCenterPos = new THREE.Vector3(-0.04, 0.743 + 0.02, -0.38); // 2cm above desk surface
    const isDeskNear = keyboardSys.isPositionInProximity(deskCenterPos);
    assert('Hand resting/typing 2cm above keyboard is recognized as IN DESK ZONE', isDeskNear === true);

    const deskTypingPos = new THREE.Vector3(0.05, 0.743 + 0.03, -0.36); // Typing letters in keyboard area
    assert('Hand moving over keyboard keys (3cm height) is IN DESK ZONE', keyboardSys.isPositionInProximity(deskTypingPos) === true);

    const airPos = new THREE.Vector3(-0.04, 0.743 + 0.22, -0.38); // 22cm above desk (lifted into air)
    assert('Hand lifted 22cm into air is recognized as OUTSIDE DESK ZONE (Air Zone)', keyboardSys.isPositionInProximity(airPos) === false);

    const lapPos = new THREE.Vector3(0.20, 0.50, -0.15); // Resting hand in lap away from desk
    assert('Hand resting in lap away from keyboard is OUTSIDE DESK ZONE', keyboardSys.isPositionInProximity(lapPos) === false);

    // B. Unified Gaze Commit Pipeline Verification
    let unifiedCommitCount = 0;
    const testUnifiedGazeCommit = (): boolean => {
      unifiedCommitCount++;
      if (workspaceSys.isLookingAtSwitchIcon) {
        workspaceSys.swapWindows();
        return true;
      }
      const handled = notificationSys.handleGazeCommit();
      if (handled) return true;
      if (simulationMenu.group.visible && simulationMenu.isGazeHovered()) {
        return simulationMenu.handleGazePinch();
      }
      return false;
    };

    // Simulate onPinchStart logic with Desk Zone Guard
    const simulatePinchStart = (pinchWorldPos: THREE.Vector3): boolean => {
      // Desk Zone Guard
      if (keyboardSys.isPositionInProximity(pinchWorldPos)) {
        return false; // Suppressed in desk zone!
      }
      // Air Pinch Commit
      return testUnifiedGazeCommit();
    };

    // C. Conflict Prevention: Typing in Desk Zone does NOT trigger Gaze Commit
    const typingPinchPos = new THREE.Vector3(-0.02, 0.743 + 0.02, -0.37);
    const typingTriggered = simulatePinchStart(typingPinchPos);
    assert(
      'Typing motion in desk zone with fingers curling DOES NOT trigger gaze commit (Desk Guard active)',
      typingTriggered === false && unifiedCommitCount === 0
    );

    // D. Symmetrical Action: Incoming Call handled by Air Pinch vs Trackpad Tap
    notificationSys.triggerNotification({
      type: 'call',
      name: 'Sarah Connor',
      role: 'Director',
      avatarColor: '#10b981',
      subtitle: 'Incoming Call',
      body: 'Incoming Call'
    });
    assert('Call state is incoming (peripheral_pill or expanded)', notificationSys.callState !== 'idle');

    // Focus gaze on call
    notificationSys.isLookingAtPhone = true;
    notificationSys.isLookingAtPPT = false;
    notificationSys.activeFocusedChannel = 'call';
    notificationSys.switchCallState('expanded_card');
    notificationSys.focusedCallButton = 'accept';
    (notificationSys as any).lastTrackpadClickTime = -1000;

    // 1. Commit via Air Pinch (in air)
    const airPinchPos = new THREE.Vector3(0.15, 1.10, -0.50);
    const airHandled = simulatePinchStart(airPinchPos);

    assert('Air Pinch in air zone successfully commits gaze action', airHandled === true);
    assert('Call was accepted via Air Pinch (active_call)', notificationSys.callState === 'active_call');

    // End call
    notificationSys.endCall();
    assert('Call ended cleanly', notificationSys.callState === 'call_ended' || notificationSys.callState === 'idle');

    // 2. Commit via Desk Trackpad Tap
    notificationSys.triggerNotification({
      type: 'call',
      name: 'Sarah Connor',
      role: 'Director',
      avatarColor: '#10b981',
      subtitle: 'Incoming Call',
      body: 'Incoming Call'
    });
    notificationSys.isLookingAtPhone = true;
    notificationSys.isLookingAtPPT = false;
    notificationSys.activeFocusedChannel = 'call';
    notificationSys.switchCallState('expanded_card');
    notificationSys.focusedCallButton = 'accept';
    (notificationSys as any).lastTrackpadClickTime = -1000;

    const trackpadHandled = testUnifiedGazeCommit();
    assert('Desk Trackpad Tap successfully commits gaze action', trackpadHandled === true);
    assert('Call was accepted via Desk Trackpad (active_call)', notificationSys.callState === 'active_call');

    notificationSys.endCall();

    // E. Symmetrical Action: SMS Card Expand
    // Reset SMS items to peripheral_pill
    for (const item of notificationSys.activeSmsList) {
      notificationSys.switchSmsState('peripheral_pill', item);
    }
    const smsItem = notificationSys.activeSmsList[0];
    notificationSys.isLookingAtPhone = true;
    notificationSys.isLookingAtPPT = false;
    notificationSys.activeFocusedChannel = smsItem.id;
    (notificationSys as any).lastTrackpadClickTime = -1000;

    // Expand via Air Pinch
    simulatePinchStart(airPinchPos);
    assert('Air Pinch expands SMS peripheral pill to expanded_card', smsItem.state === 'expanded_card');

    // Collapse back
    notificationSys.isLookingAtPhone = false;
    notificationSys.isLookingAtPPT = true;
    (notificationSys as any).lastTrackpadClickTime = -1000;
    simulatePinchStart(airPinchPos);
    assert('Gaze off phone + Air Pinch collapses expanded card to peripheral pill', smsItem.state === 'peripheral_pill');

    // Expand via Trackpad Tap
    notificationSys.isLookingAtPhone = true;
    notificationSys.isLookingAtPPT = false;
    notificationSys.activeFocusedChannel = smsItem.id;
    (notificationSys as any).lastTrackpadClickTime = -1000;
    testUnifiedGazeCommit();
    assert('Desk Trackpad Tap expands SMS peripheral pill symmetrically to expanded_card', smsItem.state === 'expanded_card');
  }

  // --------------------------------------------------------------------------
  console.log('\nTest Suite 8: Surface Keyboard Keystroke Anti-Chatter & Single-Press Lock');
  // --------------------------------------------------------------------------
  {
    notificationSys.switchSmsState('reply_active', notificationSys.activeSmsList[0]);
    notificationSys.replyText = '';

    // Create a mock frame for keyboard update
    function createKeyboardHandFrame(handedness: 'left' | 'right', localPos: THREE.Vector3) {
      const worldPos = keyboardSys.mesh.localToWorld(localPos.clone());
      const mockHand = new Map();
      mockHand.set('index-finger-tip', 'joint-idx');

      const mockSession = {
        inputSources: [
          {
            handedness,
            hand: mockHand
          }
        ]
      };

      const mockFrame: any = {
        getJointPose: () => ({
          transform: {
            position: { x: worldPos.x, y: worldPos.y, z: worldPos.z }
          }
        })
      };

      return { session: mockSession, refSpace: {}, frame: mockFrame };
    }

    function updateKeyboardHand(handedness: 'left' | 'right', localPos: THREE.Vector3) {
      const mock = createKeyboardHandFrame(handedness, localPos);
      (keyboardSys as any).xr.xrSession = mock.session;
      (keyboardSys as any).xr.refSpace = mock.refSpace;
      keyboardSys.update(performance.now(), mock.frame);
    }

    // Key position for key near center of keyboard (local x = 0, y = 0)
    // 1. Finger starts in air at 30mm height: local.z = 0.030
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.030));
    assert('Initial lifted finger (30mm) arms the finger without typing', notificationSys.replyText.length === 0);

    // 2. Finger descends to 10mm (desk trigger window)
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.010));
    assert('Downward strike past 12mm types exactly 1 character', notificationSys.replyText.length === 1);

    // 3. Follow-through to physical desk (z = 0.002, 2mm)
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.002));
    assert('Follow-through down to physical desk (2mm) DOES NOT re-trigger', notificationSys.replyText.length === 1);

    // 4. Resting on desk with optical noise jitter (z oscillates between 1mm and 8mm)
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.008));
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.003));
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.006));
    assert('Resting on desk with tracking flutter (1-8mm) NEVER multi-types (still 1 char)', notificationSys.replyText.length === 1);

    // 5. Deliberately lifting finger back up past 18mm arming threshold (z = 0.025, 25mm)
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.025));
    assert('Lifting finger off desk into air does not type on release', notificationSys.replyText.length === 1);

    // Advance lastPressTime by 200ms to simulate next stroke
    (keyboardSys as any).fingerState['right'].lastPressTime = -1000;

    // 6. Second deliberate downward strike (types 2nd character)
    updateKeyboardHand('right', new THREE.Vector3(0, 0, 0.010));
    assert('Second deliberate downward strike types second character', notificationSys.replyText.length === 2);
  }

  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} AUTOMATED CLI TESTS PASSED SUCCESSFULLY!`);
  } else {
    console.error(`⚠️ ${failed} test(s) failed out of ${passed + failed}`);
  }
  console.log('====================================================\n');
}

runCliTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
