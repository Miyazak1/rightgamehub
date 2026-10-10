class E {
  constructor(x, y, type, a) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.vx = 0;
    this.vy = 0;
    this.r = 8;
    this.captured = 0;
    this.inactive = 0;
    this.inactiveTime = 0;
    this.a = a;
    this.lastSound = 0;
    this.mouseInfluenced = 0;
  }

  u(mouse, orbitals, game) {
    if (this.captured) return;
    if (!orbitals || !Array.isArray(orbitals)) return;

    if (this.inactive > 0) {
      this.inactive -= 1 / 60;
      this.inactiveTime = this.inactive;
      if (this.inactive <= 0) {
        this.inactive = 0;
        this.inactiveTime = 0;
      }
      return;
    }

    let dx = mouse.x - this.x,
      dy = mouse.y - this.y,
      dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 120) {
      this.mouseInfluenced = 1;
      let force = (0.3 * (120 - dist)) / 120;
      let fx = (dx / dist) * force,
        fy = (dy / dist) * force;

      if (this.type === 0) {
        this.vx += fx * 0.5;
        this.vy += fy * 0.5;
      } else {
        this.vx -= fx * 0.5;
        this.vy -= fy * 0.5;
      }
    } else this.mouseInfluenced = 0;

    for (let orb of orbitals) {
      let dx = orb.x - this.x,
        dy = orb.y - this.y,
        dist = Math.sqrt(dx * dx + dy * dy);

      if (orb.stunned <= 0.1 && dist < 60) {
        let force = (0.1 * (60 - dist)) / 60;
        let fx = (dx / dist) * force,
          fy = (dy / dist) * force;

        if (this.type === orb.type) {
          this.vx += fx;
          this.vy += fy;
        } else {
          this.vx -= fx * 0.5;
          this.vy -= fy * 0.5;
        }
      }

      if (dist < 25) {
        if (!orb.occupied && orb.stunned <= 0.1 && this.type === orb.type) {
          // Check electron configuration rules
          if (game.o.followsElectronConfig(orb)) {
            orb.occupied = 1;
            this.captured = 1;
            orb.stunCount = 0;

            // Tutorial callbacks for task completion
            if (game.tutorial) {
              game.tutorial.hideHint();
              // Check if this was a blue electron (type 0) being captured
              if (this.type === 0) {
                game.tutorial.onBlueElectronCaptured();
              }
            }

            if (this.a?.c) {
              this.a.p(1, 0.5);
            }
            return;
          } else {
            // Trigger hint for rule violation
            if (game.tutorial) {
              game.tutorial.onFullOrbital();
            }

            let repelForce = 8;
            let repelX = ((this.x - orb.x) / dist) * repelForce;
            let repelY = ((this.y - orb.y) / dist) * repelForce;
            this.vx = repelX;
            this.vy = repelY;

            let pushOut = 30;
            this.x = orb.x + ((this.x - orb.x) / dist) * pushOut;
            this.y = orb.y + ((this.y - orb.y) / dist) * pushOut;

            this.inactive = 0.3;
            this.inactiveTime = 0.3;
            if (this.a?.c) {
              this.a.p(3, 0.3);
            }
            game.stun(orb, false);
            return;
          }
        } else if (!orb.occupied && this.type !== orb.type) {
          let repelForce = 12;
          let repelX = ((this.x - orb.x) / dist) * repelForce;
          let repelY = ((this.y - orb.y) / dist) * repelForce;
          this.vx = repelX;
          this.vy = repelY;

          let pushOut = 30;
          this.x = orb.x + ((this.x - orb.x) / dist) * pushOut;
          this.y = orb.y + ((this.y - orb.y) / dist) * pushOut;

          this.inactive = 0.3;
          this.inactiveTime = 0.3;
          if (this.a?.c) {
            this.a.p(3, 0.3);
          }
          game.stun(orb, false);
          return;
        } else if (orb.occupied) {
          let repelForce = 12;
          let repelX = ((this.x - orb.x) / dist) * repelForce;
          let repelY = ((this.y - orb.y) / dist) * repelForce;
          this.vx = repelX;
          this.vy = repelY;

          let pushOut = 30;
          this.x = orb.x + ((this.x - orb.x) / dist) * pushOut;
          this.y = orb.y + ((this.y - orb.y) / dist) * pushOut;

          this.inactive = 0.3;
          this.inactiveTime = 0.3;
          game.hit(orb);
          return;
        }
      }
    }
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.98;
    this.vy *= 0.98;
    let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    let now = Date.now();
    let r = this.r;
    if (this.x < r) {
      this.x = r;
      this.vx = -this.vx * 0.8;
      this.sound(speed, now);
    }
    if (this.x > 1000 - r) {
      this.x = 1000 - r;
      this.vx = -this.vx * 0.8;
      this.sound(speed, now);
    }
    if (this.y < r) {
      this.y = r;
      this.vy = -this.vy * 0.8;
      this.sound(speed, now);
    }
    if (this.y > 750 - r) {
      this.y = 750 - r;
      this.vy = -this.vy * 0.8;
      this.sound(speed, now);
    }

    if (this.x < 220 && this.y < 120) {
      if (this.y > 110) {
        this.y = 120;
        this.vy = Math.abs(this.vy);
      }
      if (this.x > 210) {
        this.x = 220;
        this.vx = Math.abs(this.vx);
      }
    }
    if (this.y > 550) {
      this.y = 550;
      this.vy = -Math.abs(this.vy);
    }
    if (this.x > 580 && this.y < 100) {
      if (this.y > 90) {
        this.y = 100;
        this.vy = Math.abs(this.vy);
      }
      if (this.x < 590) {
        this.x = 580;
        this.vx = -Math.abs(this.vx);
      }
    }
  }

  sound(speed, now) {
    if (this.a?.c && this.a?.p && now - this.lastSound > 30) {
      this.a.p(0, Math.min(0.6, speed / 6));
      this.lastSound = now;
    }
  }

  d(ctx) {
    if (this.captured) return;

    ctx.save();

    let colors = [
      ["rgba(100,150,255,.8)", "rgb(150,200,255)", "rgb(100,150,255)"],
      ["rgba(255,150,100,.8)", "rgb(255,200,150)", "rgb(255,150,100)"],
    ];
    let c = colors[this.type] || [
      "rgba(128,128,128,.8)",
      "rgb(180,180,180)",
      "rgb(120,120,120)",
    ];

    if (this.mouseInfluenced && !this.inactive) {
      ctx.shadowColor = c[0];
      ctx.shadowBlur = 15;
    }

    let grad = ctx.createRadialGradient(
      this.x,
      this.y,
      0,
      this.x,
      this.y,
      this.r
    );

    if (this.inactive && this.inactiveTime > 0) {
      let pulse = 0.5 + 0.3 * Math.sin(Date.now() * 0.01);
      grad.addColorStop(0, `rgba(180,180,180,${pulse})`);
      grad.addColorStop(1, `rgba(120,120,120,${pulse * 0.7})`);
    } else {
      grad.addColorStop(0, c[1]);
      grad.addColorStop(1, c[2]);
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, 6.28);
    ctx.fill();

    if (!this.inactive) {
      ctx.fillStyle = c[1];
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(this.type ? "p" : "s", this.x, this.y + 3);
    }

    ctx.restore();
  }
}
