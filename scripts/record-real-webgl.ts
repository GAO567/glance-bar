import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ARTIFACT_DIR = '/Users/gao/.gemini/antigravity/brain/9271e53e-6a41-4a8d-ab63-7ba9d5c5bd72';
const OUTPUT_FILE = path.join(ARTIFACT_DIR, 'real_webgl_recording.mp4');

const TOTAL_FRAMES = 780; // 26 seconds @ 30 FPS
const FPS = 30;

async function recordRealWebGL() {
  console.log('🚀 Launching Headless Chrome for Real WebGL Recording...');
  console.log(`Target: ${OUTPUT_FILE} (1280x720 @ 30fps, 26s)`);

  const chromePort = 9700 + Math.floor(Math.random() * 200);
  const chromeDataDir = path.join('/tmp', `chrome-rec-${Date.now()}`);

  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--ignore-certificate-errors',
    '--window-size=1280,720',
    '--no-first-run',
    '--use-gl=angle',
    '--use-angle=metal',
    `--user-data-dir=${chromeDataDir}`,
    'https://127.0.0.1:5173/'
  ]);

  // Give Chrome 2.5s to start and load the Vite app
  await new Promise(r => setTimeout(r, 2500));

  let ffmpeg: any;
  let ws: any;

  try {
    const listRes = await fetch(`http://127.0.0.1:${chromePort}/json`);
    const pages = await listRes.json();
    const targetPage = pages.find((p: any) => p.type === 'page') || pages.find((p: any) => p.url.includes('5173'));
    if (!targetPage) throw new Error('Could not find GlanceBar page in Chrome');

    ws = new WebSocket(targetPage.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    let msgId = 1;
    function send(method: string, params: any = {}): Promise<any> {
      return new Promise((resolve) => {
        const id = msgId++;
        const handler = (event: any) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', handler);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    console.log('🔗 Connected to Chrome via CDP WebSocket!');
    await send('Page.enable');
    await send('Runtime.enable');

    // Wait for in-page test runner to be ready
    let isReady = false;
    for (let retry = 0; retry < 30; retry++) {
      const res = await send('Runtime.evaluate', {
        expression: 'Boolean(window.__GLANCEBAR__ && window.__GLANCEBAR__.initTestRunner)'
      });
      console.log(`Probe attempt ${retry + 1}:`, res?.result?.value);
      if (res?.result?.value === true) {
        isReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!isReady) {
      throw new Error('window.__GLANCEBAR__.initTestRunner did not become ready in time!');
    }

    const initRes = await send('Runtime.evaluate', {
      expression: 'window.__GLANCEBAR__.initTestRunner(); "RUNNER_READY";'
    });
    console.log('In-page test runner initialized:', initRes);

    // Wait 2.0s for initial 3D animations and textures to load
    await new Promise(r => setTimeout(r, 2000));

    console.log('🎬 Initializing FFmpeg encoder for real WebGL stream...');
    ffmpeg = spawn('/opt/homebrew/bin/ffmpeg', [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(FPS),
      '-i', '-',
      '-vf', 'scale=1280:720',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      OUTPUT_FILE
    ], { stdio: ['pipe', 'inherit', 'inherit'] });

    // Render & Capture loop
    console.log(`🎥 Starting frame-by-frame WebGL capture (${TOTAL_FRAMES} frames)...`);
    const dt = 1 / FPS;

    for (let f = 0; f < TOTAL_FRAMES; f++) {
      // 1. Advance step in scene
      await send('Runtime.evaluate', {
        expression: `window.__GLANCEBAR__.stepTestRunner(${f}, ${dt})`
      });

      // 2. Capture screenshot of the full WebGL screen
      const shot = await send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 85
      });

      if (!shot || !shot.data) {
        throw new Error(`Failed to capture screenshot at frame ${f}`);
      }

      // 3. Pipe JPEG buffer to FFmpeg
      const buf = Buffer.from(shot.data, 'base64');
      const canWrite = ffmpeg.stdin.write(buf);
      if (!canWrite) {
        await new Promise<void>(res => ffmpeg.stdin.once('drain', res));
      }

      if (f % 60 === 0 || f === TOTAL_FRAMES - 1) {
        console.log(`Rendered WebGL frame ${f + 1} / ${TOTAL_FRAMES} (${(((f + 1) / TOTAL_FRAMES) * 100).toFixed(0)}%)`);
      }
    }

    ffmpeg.stdin.end();

    await new Promise<void>((resolve, reject) => {
      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          console.log(`✅ Real WebGL Video generated successfully at: ${OUTPUT_FILE}`);
          const stat = fs.statSync(OUTPUT_FILE);
          console.log(`Video size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
    });

  } catch (err) {
    console.error('Recording failed:', err);
    throw err;
  } finally {
    if (ws) ws.close();
    chrome.kill();
  }
}

recordRealWebGL().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
