class A {
  constructor() {
    this.c = null;
    this.g = null;
    this.muted = 0;
    this.s = [];
  }

  async i() {
    if (this.c) return;
    this.c = new (AudioContext || webkitAudioContext)();
    this.g = this.c.createGain();
    this.g.gain.value = 0.3;
    this.g.connect(this.c.destination);

    this.delay = this.c.createDelay(0.5);
    this.delay.delayTime.value = 0.15;
    this.feedback = this.c.createGain();
    this.feedback.gain.value = 0.25;
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.g);

    this.s = [
      this.b([1, 800, 0.3, 0.3, 0.002, 0.2]),
      this.b([1, 659, 0.35, 0.4, 0.005, 0.25]),
      this.b([2, 311, 0.25, 0.3, 0.002, 0.15]),
      this.b([1, 440, 0.25, 0.2, 0.01, 0.3]),
      this.b([1, 247, 0.2, 0.25, 0.002, 0.12]),
      this.b([1, 1175, 0.12, 0.15, 0.001, 0.08]),
      this.b([1, 698, 0.35, 0.4, 0.003, 0.25]),
      this.b([1, 523, 0.5, 0.5, 0.01, 0.3]),
      this.b([1, 1318, 0.4, 0.3, 0.002, 0.3]),
    ];
  }

  b(p) {
    const l = this.c.sampleRate * p[2];
    const buf = this.c.createBuffer(1, l, this.c.sampleRate);
    const d = buf.getChannelData(0);
    const a = p[4] * this.c.sampleRate;
    const r = (p[2] - p[5]) * this.c.sampleRate;

    for (let i = 0; i < l; i++) {
      let v;
      if (p[0] == 1) v = Math.sin((i * p[1] * 6.28) / this.c.sampleRate);
      else if (p[0] == 2) v = Math.random() * 2 - 1;
      else v = (((i * p[1] * 4) / this.c.sampleRate) % 2) - 1;

      let e = 1;
      if (i < a) e = i / a;
      else if (i > r) e = (l - i) / (l - r);

      d[i] = v * e * p[3];
    }
    return buf;
  }

  p(i, e, echo) {
    if (!this.c || this.muted) return;
    if (this.c.state === "suspended") {
      this.c.resume();
    }

    const now = Date.now();
    this.lastPlay = this.lastPlay || {};
    if (i !== 1 && this.lastPlay[i] && now - this.lastPlay[i] < 25) return;
    this.lastPlay[i] = now;

    const s = this.c.createBufferSource();
    const g = this.c.createGain();
    s.buffer = this.s[i];
    // Lowered default sound effect volume from 0.5 to 0.22
    g.gain.value = isFinite(e) ? e * 0.44 : 0.22;
    s.connect(g);
    g.connect(this.g);
    if (echo && this.delay) g.connect(this.delay);
    s.start();

    if (i === 1) {
      setTimeout(() => this.p(8, 0.6, true), 100);
    }
  }

  m() {
    if (!this.c) return;

    const chords = [
      [220, 264, 330],
      [175, 220, 262],
      [196, 247, 294],
      [196, 247, 294],
    ];

    const melodyNotes = [
      440, 392, 349, 330, 294, 330, 349, 392, 440, 523, 494, 440, 392, 349, 330,
      294,
    ];

    let chordIndex = 0;
    let melodyIndex = 0;

    const bass = this.c.createOscillator();
    const bassGain = this.c.createGain();
    bass.type = "sine";
    bass.frequency.value = 110;
    bassGain.gain.setValueAtTime(0, this.c.currentTime);
    bassGain.gain.linearRampToValueAtTime(0.03, this.c.currentTime + 4); // Increased from 0.006
    bass.connect(bassGain);
    bassGain.connect(this.g);
    bass.start();

    const chordOscs = [];
    for (let i = 0; i < 3; i++) {
      const osc = this.c.createOscillator();
      const gain = this.c.createGain();
      const filter = this.c.createBiquadFilter();

      osc.type = "triangle";
      filter.type = "lowpass";
      filter.frequency.value = 600;
      filter.Q.value = 0.7;

      gain.gain.setValueAtTime(0, this.c.currentTime);
      gain.gain.linearRampToValueAtTime(0.04, this.c.currentTime + 3 + i); // Increased from 0.008

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.g);
      osc.start();

      chordOscs.push({ osc, gain });
    }

    const melody = this.c.createOscillator();
    const melodyGain = this.c.createGain();
    const melodyFilter = this.c.createBiquadFilter();

    melody.type = "sine";
    melodyFilter.type = "lowpass";
    melodyFilter.frequency.value = 1200;
    melodyGain.gain.setValueAtTime(0, this.c.currentTime);

    melody.connect(melodyFilter);
    melodyFilter.connect(melodyGain);
    melodyGain.connect(this.g);
    if (this.delay) melodyGain.connect(this.delay);
    melody.start();

    const changeChord = () => {
      const currentChord = chords[chordIndex];

      if (bass.frequency) {
        const bassNote = currentChord[0] / 2;
        bass.frequency.exponentialRampToValueAtTime(
          bassNote,
          this.c.currentTime + 1
        );
      }

      chordOscs.forEach((voice, i) => {
        if (voice.osc.frequency) {
          voice.osc.frequency.exponentialRampToValueAtTime(
            currentChord[i],
            this.c.currentTime + 1.5
          );
        }
      });

      chordIndex = (chordIndex + 1) % chords.length;
      setTimeout(changeChord, 8000);
    };

    const playMelodyNote = () => {
      const note = melodyNotes[melodyIndex];

      if (melody.frequency) {
        melodyGain.gain.cancelScheduledValues(this.c.currentTime);
        melodyGain.gain.setValueAtTime(0, this.c.currentTime);
        melodyGain.gain.linearRampToValueAtTime(0.02, this.c.currentTime + 0.3); // Increased from 0.004
        melodyGain.gain.linearRampToValueAtTime(0.008, this.c.currentTime + 2);

        melody.frequency.exponentialRampToValueAtTime(
          note,
          this.c.currentTime + 0.1
        );
      }

      melodyIndex = (melodyIndex + 1) % melodyNotes.length;
      setTimeout(playMelodyNote, 2500 + Math.random() * 1000);
    };

    setTimeout(changeChord, 4000);
    setTimeout(playMelodyNote, 6000);
  }

  t() {
    this.muted = !this.muted;
    this.g.gain.value = this.muted ? 0 : 0.3;
    return this.muted;
  }
}
