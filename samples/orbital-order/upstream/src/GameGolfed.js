class G {
  constructor() {
    this.c = document.getElementById("gameCanvas");
    this.ctx = this.c.getContext("2d");

    this.audio = new A();

    this.input = { mouse: { x: 400, y: 300 } };
    this.c.addEventListener("mousemove", async (e) => {
      let rect = this.c.getBoundingClientRect();
      this.input.mouse.x = e.clientX - rect.left;
      this.input.mouse.y = e.clientY - rect.top;

      // Try to initialize audio on any mouse movement
      if (!this.audio.c) {
        try {
          await this.audio.i();
          this.audio.m();
        } catch (err) {}
      }
    });

    this.c.addEventListener("mousedown", async () => {
      if (!this.audio.c) {
        await this.audio.i();
        this.audio.m();
      }
    });

    this.o = new O(this.c, this.audio, this);
    this.tutorial = new T(this);

    this.electrons = [];
    this.particles = [];

    this.spawn();
    this.spawnParticles();

    this.c.addEventListener("click", async (e) => {
      // If level completion display is showing, dismiss it
      if (this.o.dismissLevelComplete()) {
        return;
      }

      if (this.o.checkComplete()) {
        this.o.nextLevel();
        this.spawn();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "m" || e.key === "M") {
        this.audio.t();
      } else if (e.key === "i" || e.key === "I" || e.key === "?") {
        this.tutorial.toggleHelp();
      } else if (e.key === "Escape") {
        // Close log if open, otherwise toggle help
        if (this.tutorial.logVisible) {
          this.tutorial.toggleLog();
        } else {
          this.tutorial.toggleHelp();
        }
      } else if (e.key === "l" || e.key === "L") {
        this.tutorial.toggleLog();
      }
    });

    this.loop();
  }

  spawn() {
    this.electrons = [];
    let types = [0, 1];
    let hasBlue = false,
      hasOrange = false;

    types.forEach((type) => {
      let count = this.o.o.filter((o) => o.type === type).length;
      if (count > 0) {
        if (type === 0) hasBlue = true;
        if (type === 1) hasOrange = true;
      }

      for (let i = 0; i < count; i++) {
        let x,
          y,
          attempts = 0;
        do {
          x = Math.random() * (this.c.width - 200) + 100;
          y = Math.random() * (this.c.height - 200) + 100;
          attempts++;
        } while (attempts < 10 && this.nearOrbital(x, y, 60));

        this.electrons.push(new E(x, y, type, this.audio));
      }
    });

    // Trigger tutorial events
    if (hasBlue) this.tutorial.onBlueSpawn();
    if (hasOrange) this.tutorial.onOrangeSpawn();
  }

  respawn(type) {
    let x,
      y,
      attempts = 0;
    do {
      x = Math.random() * (this.c.width - 200) + 100;
      y = Math.random() * (this.c.height - 200) + 100;
      attempts++;
    } while (attempts < 10 && this.nearOrbital(x, y, 60));

    let e = new E(x, y, type, this.audio);
    e.vx = (Math.random() - 0.5) * 3;
    e.vy = (Math.random() - 0.5) * 3;
    this.electrons.push(e);
  }

  nearOrbital(x, y, minDist) {
    return this.o.o.some((o) => {
      let dx = x - o.x,
        dy = y - o.y;
      return Math.sqrt(dx * dx + dy * dy) < minDist;
    });
  }

  spawnParticles() {
    this.particles = [];
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: Math.random() * this.c.width,
        y: Math.random() * this.c.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.4 + 0.1,
        phase: Math.random() * 6.28,
        size: Math.random() * 1.5 + 0.5,
      });
    }
  }

  update() {
    this.o.u();
    this.tutorial.update();

    // Don't update game physics when help is open
    if (this.tutorial.isGamePaused()) return;

    for (let p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.phase += 0.02;

      if (p.x < 0) p.x = this.c.width;
      if (p.x > this.c.width) p.x = 0;
      if (p.y < 0) p.y = this.c.height;
      if (p.y > this.c.height) p.y = 0;
    }

    for (let e of this.electrons) {
      e.u(this.input.mouse, this.o.o, this);

      this.o.applyStormForces(e);
    }
  }

  draw() {
    this.ctx.fillStyle = "rgb(10,10,20)";
    this.ctx.fillRect(0, 0, this.c.width, this.c.height);

    this.ctx.save();
    for (let p of this.particles) {
      let twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p.phase));
      this.ctx.fillStyle = `rgba(200,220,255,${p.alpha * twinkle})`;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, 6.28);
      this.ctx.fill();
    }
    this.ctx.restore();

    // Don't draw cursor effect when help is open
    if (!this.tutorial.isGamePaused()) {
      let ctx = this.ctx;
      ctx.save();
      ctx.translate(this.input.mouse.x, this.input.mouse.y);

      let time = Date.now() * 0.003;

      ctx.shadowColor = "rgba(0,255,255,0.9)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(0, 0, 5 + Math.sin(time) * 0.8, 0, 6.28);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(0,255,255,0.8)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        let baseAngle = (time * 0.5 + i * 1.3) % 6.28;
        let randomOffset =
          Math.sin(time * 3 + i * 2.7) * 0.8 + (Math.random() - 0.5) * 1.2;
        let angle = baseAngle + randomOffset;

        let length = 4 + Math.random() * 6 + Math.sin(time * 2 + i) * 2;

        ctx.beginPath();
        ctx.moveTo(0, 0);

        let segments = 2 + Math.floor(Math.random() * 2);
        let x = 0,
          y = 0;

        for (let seg = 0; seg < segments; seg++) {
          let segmentLength = length / segments;
          let segmentAngle = angle + (Math.random() - 0.5) * 0.4;
          x += Math.cos(segmentAngle) * segmentLength;
          y += Math.sin(segmentAngle) * segmentLength;
          ctx.lineTo(x, y);
        }

        ctx.stroke();
      }

      ctx.restore();
    }

    this.o.d(this.ctx);

    // Don't draw electrons when help is open or level completion is showing
    if (!this.tutorial.isGamePaused() && !this.tutorial.shouldHideElectrons()) {
      for (let e of this.electrons) {
        e.d(this.ctx);
      }
    }

    // Render tutorial hints in front of orbitals and electrons
    this.tutorial.render(this.ctx);

    // Update HTML UI zones instead of drawing text on canvas
    this.updateUI();
  }

  updateUI() {
    // Update level info (bottom right)
    const levelInfo = document.getElementById("levelInfo");
    if (levelInfo) {
      let totalLevelsCompleted = this.o.cycle * this.o.L.length + this.o.l + 1;
      if (this.o.cycle > 0) {
        levelInfo.textContent = `Level: ${totalLevelsCompleted}`;
      } else {
        levelInfo.textContent = `Level: ${this.o.l + 1}/${this.o.L.length}`;
      }
    }
  }

  loop() {
    this.update();
    this.draw();
    requestAnimationFrame(() => this.loop());
  }

  hit(orb) {
    this.o.gameRef = this;
    this.o.hit(orb);
  }

  stun(orb, playSound) {
    this.o.stun(orb, playSound);
  }
}
