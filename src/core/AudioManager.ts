/**
 * Procedural Audio Synthesizer using Web Audio API
 * No external audio files required. Ensures instant playback in WebXR without network latency.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private isMusicPlaying = false;
  private musicIntervalId: number | null = null;
  public isMuted = false;

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Play a clean, discrete glass-like notification chime
   */
  public playNotificationChime() {
    this.initContext();
    if (!this.ctx) return;
    if (this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';

    // Harmonic two-tone chime (F#5 to C#6)
    osc1.frequency.setValueAtTime(739.99, now);
    osc1.frequency.exponentialRampToValueAtTime(1108.73, now + 0.08);

    osc2.frequency.setValueAtTime(1479.98, now);
    osc2.frequency.exponentialRampToValueAtTime(2217.46, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.85);
    osc2.stop(now + 0.85);
  }

  /**
   * Play soft tactile click / pinch feedback
   */
  public playPinchClick() {
    this.initContext();
    if (!this.ctx) return;
    if (this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  /**
   * Play smooth swoosh sound when message is sent
   */
  public playSendSwoosh() {
    this.initContext();
    if (!this.ctx) return;
    if (this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.22);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.32);
  }

  /**
   * Play incoming phone call ring tone
   */
  public playRingTone() {
    this.initContext();
    if (!this.ctx) return;
    if (this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(440, now); // A4
    osc2.frequency.setValueAtTime(480, now); // B4

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.setValueAtTime(0.12, now + 0.4);
    gain.gain.setValueAtTime(0.001, now + 0.45);
    gain.gain.setValueAtTime(0.12, now + 0.6);
    gain.gain.setValueAtTime(0.001, now + 1.0);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.1);
    osc2.stop(now + 1.1);
  }

  /**
   * Play call ended / declined tone
   */
  public playCallEnd() {
    this.initContext();
    if (!this.ctx) return;
    if (this.isMuted) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(330, now + 0.12);
    osc.frequency.setValueAtTime(220, now + 0.24);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  /**
   * Toggle gentle ambient lo-fi music simulation
   */
  public toggleMusic(enable: boolean) {
    this.initContext();
    if (!this.ctx) return;

    if (!enable) {
      this.isMusicPlaying = false;
      if (this.musicIntervalId) {
        clearInterval(this.musicIntervalId);
        this.musicIntervalId = null;
      }
      return;
    }

    if (this.isMusicPlaying) return;
    this.isMusicPlaying = true;

    const chords = [
      [261.63, 329.63, 392.00], // C
      [220.00, 261.63, 329.63], // Am
      [174.61, 220.00, 261.63], // F
      [196.00, 246.94, 293.66], // G
    ];
    let step = 0;

    const playChord = () => {
      if (!this.isMusicPlaying || !this.ctx) return;
      const notes = chords[step % chords.length];
      step++;

      const now = this.ctx.currentTime;
      notes.forEach((freq) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.03, now + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(now);
        osc.stop(now + 2.3);
      });
    };

    playChord();
    this.musicIntervalId = window.setInterval(playChord, 2200);
  }
}

export const audioManager = new AudioManager();
