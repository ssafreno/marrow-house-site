// ============================================================================
// Marrow House: procedural soundscape (Web Audio, no samples).
//   const audio = createAudio();  audio.unlock()  (call from a user gesture)
//   audio.apply(directive)        crossfade music + update ambient layers
//   audio.thunder(strength)       rumble after a lightning flash
//   audio.setEnabled(bool)
// Peak output is kept well under -12 dBFS (layer gains + a limiter + 0.5 trim).
// ============================================================================

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio() {
  let ctx = null, master = null, bus = null, enabled = true;
  let noise = {};
  let music = null, musicName = null;
  let wind = null, rain = null, room = null;
  let dir = { music: 'silence', fog: 0, flicker: 0, heartbeat: 0, props: [] };
  let creakTimer = null;

  function makeNoise(kind) {
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }
  function src(kind) { const s = ctx.createBufferSource(); s.buffer = noise[kind]; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 3); return s; }
  function filt(type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function ramp(param, v, secs = 2) { const t = ctx.currentTime; param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + secs); }

  // a small feedback-delay "room" for music box voices
  function makeVerb(out) {
    const input = gain(1), wet = gain(0.32);
    const taps = [[0.137, 0.42], [0.229, 0.38], [0.311, 0.33]];
    for (const [t, fb] of taps) {
      const dl = ctx.createDelay(1); dl.delayTime.value = t; const fbg = gain(fb); const lp = filt('lowpass', 2600);
      input.connect(dl); dl.connect(lp); lp.connect(fbg); fbg.connect(dl); lp.connect(wet);
    }
    input.connect(out); wet.connect(out);
    return input;
  }

  function scheduler(stepFn) {
    let next = ctx.currentTime + 0.1, alive = true;
    const id = setInterval(() => { if (!alive) return; while (next < ctx.currentTime + 0.35) next = stepFn(next); }, 80);
    return () => { alive = false; clearInterval(id); };
  }

  function tine(out, t, freq, vel, decay = 1.8) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = gain(0), g2 = gain(0);
    o.type = 'sine'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 4.07;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vel * 0.22, t + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); o2.connect(g2); g.connect(out); g2.connect(out);
    o.start(t); o2.start(t); o.stop(t + decay + 0.05); o2.stop(t + 0.4);
  }

  // ---------------------------------------------------------- music modules
  const MUSIC = {
    silence() { return null; },
    drone(out) {
      const g = gain(0); g.connect(out);
      const lp = filt('lowpass', 300, 5); lp.connect(g);
      const oscs = [[55, 'sawtooth', 0.5], [55 * 1.0071, 'sawtooth', 0.5], [27.5, 'sine', 0.8], [82.4, 'triangle', 0.15]].map(([f, type, v]) => {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const og = gain(v); o.connect(og); og.connect(lp); o.start(); return o;
      });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06; const lg = gain(170); lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.023; const lg2 = gain(0.03); lfo2.connect(lg2); lg2.connect(g.gain); lfo2.start();
      ramp(g.gain, 0.09, 2.5);
      return { g, stop() { [...oscs, lfo, lfo2].forEach((o) => o.stop(ctx.currentTime + 2.6)); } };
    },
    waltz(out) {
      const g = gain(0); g.connect(out); const v = makeVerb(g);
      const beat = 60 / 92; let i = 0;
      const prog = [[57, 60, 64], [62, 65, 69], [52, 56, 59], [57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59], [52, 56, 59]];
      const scale = [69, 71, 72, 74, 76, 77, 80, 81, 83, 84];
      const stop = scheduler((t) => {
        const bar = Math.floor(i / 3) % prog.length, b = i % 3, ch = prog[bar];
        const sw = (Math.random() - 0.5) * 0.02 + (b === 0 ? 0.015 : 0);
        if (b === 0) { tine(v, t + sw, mtof(ch[0] - 12), 0.07, 2.4); if (Math.random() < 0.75) tine(v, t + sw, mtof(scale[Math.floor(Math.random() * scale.length)]), 0.05, 2.0); }
        else { tine(v, t + sw, mtof(ch[1]), 0.028); tine(v, t + sw + 0.01, mtof(ch[2]), 0.024); if (b === 2 && Math.random() < 0.3) tine(v, t + beat * 0.5, mtof(scale[Math.floor(Math.random() * scale.length)] + 12), 0.025, 1.4); }
        i++; return t + beat * (1 + (Math.random() - 0.5) * 0.03);
      });
      ramp(g.gain, 1, 1.5);
      return { g, stop };
    },
    lullaby(out) {
      const g = gain(0); g.connect(out); const v = makeVerb(g);
      const beat = 60 / 64;
      // [midi, beats]; one wrong note (66 where 65 belongs) and it is slightly flat too.
      const tune = [[76, 1], [79, 1], [76, 1], [72, 2], [74, 1], [76, 1], [77, 1], [76, 1], [74, 3], [72, 1], [74, 1], [76, 1], [79, 2], [77, 1], [76, 1], [74, 1], [66, 1], [72, 3]];
      const bass = [48, 43, 45, 41, 48, 43, 41, 48];
      let n = 0, bar = 0, beatsInBar = 0;
      const stop = scheduler((t) => {
        const [m, len] = tune[n % tune.length];
        const wrong = m === 66;
        tine(v, t, mtof(m) * (wrong ? 0.985 : 1), wrong ? 0.06 : 0.05, 2.6);
        if (beatsInBar === 0) tine(v, t, mtof(bass[bar % bass.length]), 0.045, 3.0);
        beatsInBar += len; while (beatsInBar >= 3) { beatsInBar -= 3; bar++; }
        n++; const gap = n % tune.length === 0 ? 2 : 0;
        return t + (len + gap) * beat;
      });
      ramp(g.gain, 1, 2);
      return { g, stop };
    },
    heartbeat(out) {
      const g = gain(0); g.connect(out);
      const lp = filt('lowpass', 160, 1); lp.connect(g);
      const thump = (t, v) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.14);
        const e = gain(0); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(v, t + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(e); e.connect(lp); o.start(t); o.stop(t + 0.35);
      };
      const stop = scheduler((t) => {
        const bpm = 50 + Math.max(0, Math.min(1, dir.heartbeat || 0)) * 90; const p = 60 / bpm;
        thump(t, 0.5); thump(t + Math.min(0.2, p * 0.3), 0.34);
        return t + p;
      });
      ramp(g.gain, 0.9, 1.5);
      return { g, stop };
    },
    choir(out) {
      const g = gain(0); g.connect(out);
      const form = filt('peaking', 780, 1.2); form.gain.value = 8; const form2 = filt('peaking', 1150, 2); form2.gain.value = 5;
      const lp = filt('lowpass', 2400, 0.5);
      form.connect(form2); form2.connect(lp); lp.connect(g);
      const chords = [[50, 57, 62, 65, 69], [46, 53, 58, 62, 65], [43, 50, 55, 58, 62], [45, 52, 57, 61, 64]];
      const vib = ctx.createOscillator(); vib.frequency.value = 4.6; const vibG = gain(9); vib.connect(vibG); vib.start();
      const voices = chords[0].map((m) => {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sine'; o2.type = 'triangle';
        o1.frequency.value = mtof(m); o2.frequency.value = mtof(m); o2.detune.value = 7;
        vibG.connect(o1.detune); vibG.connect(o2.detune);
        const vg = gain(0.05); o1.connect(vg); o2.connect(vg); vg.connect(form);
        const n = src('white'); const bp = filt('bandpass', mtof(m) * 2, 28); const ng = gain(0.5); n.connect(bp); bp.connect(ng); ng.connect(form);
        o1.start(); o2.start();
        return { o1, o2, bp, n };
      });
      let ci = 0;
      const id = setInterval(() => {
        ci = (ci + 1) % chords.length; const t = ctx.currentTime;
        voices.forEach((v, k) => { const f = mtof(chords[ci][k]); v.o1.frequency.setTargetAtTime(f, t, 1.2); v.o2.frequency.setTargetAtTime(f, t, 1.4); v.bp.frequency.setTargetAtTime(f * 2, t, 1.2); });
      }, 9000);
      const swell = ctx.createOscillator(); swell.frequency.value = 0.05; const sg = gain(0.25); swell.connect(sg); sg.connect(g.gain); swell.start();
      ramp(g.gain, 0.55, 3);
      return { g, stop() { clearInterval(id); const t = ctx.currentTime + 2.6; voices.forEach((v) => { v.o1.stop(t); v.o2.stop(t); v.n.stop(t); }); vib.stop(t); swell.stop(t); } };
    },
  };

  function setMusic(name) {
    if (name === musicName) return;
    musicName = name;
    if (music) { const old = music; ramp(old.g.gain, 0, 2); setTimeout(() => { try { old.stop(); old.g.disconnect(); } catch (e) { /* gone */ } }, 2300); }
    const mk = MUSIC[name] || MUSIC.silence;
    music = mk(bus);
  }

  // ---------------------------------------------------------- ambient layers
  function startAmbient() {
    // room tone
    room = gain(0.05); const rn = src('brown'); const rlp = filt('lowpass', 200); rn.connect(rlp); rlp.connect(room); room.connect(bus);
    // wind
    const wn = src('pink'); const bp = filt('bandpass', 450, 0.8); const lp = filt('lowpass', 1400); wind = gain(0.02);
    wn.connect(bp); bp.connect(lp); lp.connect(wind); wind.connect(bus);
    const gust = setInterval(() => { if (!ctx) return; const t = ctx.currentTime; bp.frequency.setTargetAtTime(250 + Math.random() * 650, t, 1.6); bp.Q.setTargetAtTime(0.6 + Math.random() * 2.5, t, 2); }, 2200);
    // rain
    const rnz = src('white'); const hp = filt('highpass', 900); const rlp2 = filt('lowpass', 6500); rain = gain(0);
    rnz.connect(hp); hp.connect(rlp2); rlp2.connect(rain); rain.connect(bus);
    // creaks
    const tick = () => {
      if (ctx && enabled) { const p = 0.05 + (dir.flicker || 0) * 0.3; if (Math.random() < p) creak(); }
      creakTimer = setTimeout(tick, 900 + Math.random() * 1400);
    };
    tick();
    return gust;
  }
  function creak() {
    const t = ctx.currentTime + 0.05, dur = 0.35 + Math.random() * 0.9;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 25 + Math.random() * 45; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.6 + Math.random() * 0.9), t + dur);
    const bp = filt('bandpass', 500 + Math.random() * 1100, 7); const g = gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t + dur * 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(bp); bp.connect(g);
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan); pan.connect(bus); } else g.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function thunder(strength = 1) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + 0.3 + Math.random() * 1.2, dur = 3 + Math.random() * 2.5;
    const n = src('brown'); const lp = filt('lowpass', 320, 0.8); const g = gain(0);
    lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.42 * strength, t + 0.25); g.gain.setTargetAtTime(0.2 * strength, t + 0.3, 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(lp); lp.connect(g); g.connect(bus); n.stop(t + dur + 0.1);
  }

  function applyLayers() {
    if (!ctx) return;
    ramp(wind.gain, 0.012 + Math.max(0, Math.min(1, dir.fog || 0)) * 0.11, 2.5);
    ramp(rain.gain, (dir.props || []).includes('rain') ? 0.06 : 0, 2.5);
  }

  return {
    get ready() { return !!ctx; },
    unlock() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC();
        for (const k of ['white', 'pink', 'brown']) noise[k] = makeNoise(k);
        master = gain(enabled ? 1 : 0);
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 20; comp.attack.value = 0.003; comp.release.value = 0.25;
        const trim = gain(0.5);
        bus = gain(1); bus.connect(master); master.connect(comp); comp.connect(trim); trim.connect(ctx.destination);
        startAmbient();
        setMusic(dir.music); applyLayers();
      }
      if (ctx.state === 'suspended') ctx.resume();
    },
    setEnabled(b) { enabled = b; if (ctx) ramp(master.gain, b ? 1 : 0, 0.6); },
    apply(d) {
      dir = { ...dir, ...d };
      if (!ctx) return;
      setMusic(dir.music || 'silence'); applyLayers();
    },
    thunder,
  };
}
