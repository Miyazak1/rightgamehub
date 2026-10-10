class T {
  constructor(g) {
    this.g = g;

    // Check if tutorial has been completed
    this.completed = localStorage.getItem("tutorialDone") === "1";

    // Tutorial text bank - centralized for byte efficiency
    this.text = {
      blue: "Blue s-electrons are attracted to your cursor. Guide one into the 1s orbital.",
      orange:
        "Orange p-electrons are repelled by your cursor. Nudge them carefully.",
      full: "Follow Aufbau principle: fill lower energy orbitals first.",
      eject:
        "Hitting an occupied orbital twice will eject its electron as a penalty.",
      storms: "Storms push electrons around! Navigate them carefully.",
      help: [
        "• Blue s-electrons are attracted to cursor",
        "• Orange p-electrons are repelled by cursor",
        "• Follow Aufbau principle: fill lower energy orbitals first",
        "• Hitting occupied orbitals twice ejects electrons (penalty)",
        "• Wrong color electrons bounce off target orbitals",
        "• Storms create navigation challenges",
      ],
    };

    // Active hint state
    this.hint = null;
    this.hintTimer = 0;
    this.scienceFact = "";
    this.factTimer = 0;

    // Help overlay state
    this.helpVisible = false;

    // Element log state
    this.logVisible = false;

    // Event tracking for first-time hints
    this.events = {
      blueSpawned: false,
      orangeSpawned: false,
      fullOrbital: false,
      ejection: false,
      blueTaskCompleted: false, // Track when first blue electron is captured
      stormsIntroduced: false, // Track when first storm appears in infinite mode
    };

    // Sequential tutorial state
    this.pendingOrangeHint = false; // Queue orange hint after blue task completion

    // Element data for the log
    this.elements = [
      {
        symbol: "H",
        name: "Hydrogen",
        fact: "The most abundant element in the universe",
        color: [100, 200, 255],
      },
      {
        symbol: "He",
        name: "Helium",
        fact: "Second lightest element, first noble gas",
        color: [255, 200, 100],
      },
      {
        symbol: "Li",
        name: "Lithium",
        fact: "Lightest metal, used in batteries",
        color: [200, 100, 255],
      },
      {
        symbol: "Be",
        name: "Beryllium",
        fact: "One of the rarest elements on Earth",
        color: [100, 255, 200],
      },
      {
        symbol: "B",
        name: "Boron",
        fact: "Essential for plant growth",
        color: [255, 100, 200],
      },
      {
        symbol: "C",
        name: "Carbon",
        fact: "Foundation of all organic life",
        color: [200, 255, 100],
      },
    ];
  }

  // Show contextual hint
  showHint(text) {
    if (this.completed) return;
    this.hint = text;
    // No timer - hint stays until task completion
  }

  // Hide hint immediately (when action completed)
  hideHint() {
    this.hint = null;
  }

  // Called when blue electron gets captured - complete first task
  onBlueElectronCaptured() {
    if (!this.events.blueTaskCompleted && !this.completed) {
      this.events.blueTaskCompleted = true;

      // Fade out current hint (blue tutorial) and queue orange hint
      if (this.hint && this.hint.includes("Blue electrons")) {
        this.pendingOrangeHint = true;
        this.hideHint();
      }
    }
  }

  // Check if electrons should be hidden (during level completion)
  shouldHideElectrons() {
    // Hide electrons when level completion symbol is showing
    return this.g?.o?.levelCompleteDisplay > 0;
  }

  // Show science fact
  showScience(fact) {
    this.scienceFact = fact;
    this.factTimer = 6;
  }

  // Toggle help overlay
  toggleHelp() {
    this.helpVisible = !this.helpVisible;

    // Pause/unpause game when help is toggled
    if (this.g && this.g.audio) {
      if (this.helpVisible) {
        // Pause audio when help opens
        this.g.audio.g.gain.value = 0;
      } else {
        // Resume audio when help closes (unless muted)
        this.g.audio.g.gain.value = this.g.audio.muted ? 0 : 0.3;
      }
    }
  }

  // Toggle element log overlay
  toggleLog() {
    this.logVisible = !this.logVisible;

    // Pause/unpause game when log is toggled (same as help)
    if (this.g && this.g.audio) {
      if (this.logVisible) {
        this.g.audio.g.gain.value = 0;
      } else {
        this.g.audio.g.gain.value = this.g.audio.muted ? 0 : 0.3;
      }
    }
  }

  // Mark tutorial as completed
  complete() {
    this.completed = true;
    localStorage.setItem("tutorialDone", "1");
  }

  // Check if game should be paused
  isGamePaused() {
    return this.helpVisible || this.logVisible;
  }

  // Create particle effect when hint is completed
  createParticleEffect() {
    this.particles = [];
    // Create particles from text position
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: 300 + Math.random() * 200, // Around center area
        y: 150 + Math.random() * 100,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2 - 1, // Slight upward bias
        life: 1.0,
        maxLife: 1.0 + Math.random() * 0.5,
        size: 1 + Math.random() * 2,
      });
    }
  }

  // Event-triggered hints
  onBlueSpawn() {
    if (!this.events.blueSpawned && !this.completed) {
      this.showHint(this.text.blue);
      this.events.blueSpawned = true;
    }
  }

  onOrangeSpawn() {
    if (!this.events.orangeSpawned && !this.completed) {
      this.events.orangeSpawned = true;

      // Only show orange hint if blue task is completed, or immediately if no blue electrons exist
      if (this.events.blueTaskCompleted || !this.events.blueSpawned) {
        this.showHint(this.text.orange);
        this.pendingOrangeHint = false;
      } else {
        // Queue the orange hint for after blue task completion
        this.pendingOrangeHint = true;
      }
    }
  }

  onFullOrbital() {
    if (!this.events.fullOrbital && !this.completed) {
      this.showHint(this.text.full);
      this.events.fullOrbital = true;
    }
  }

  onEjection() {
    if (!this.events.ejection && !this.completed) {
      this.showHint(this.text.eject);
      this.events.ejection = true;
    }
  }

  onStorms() {
    if (!this.events.stormsIntroduced && !this.completed) {
      this.showHint(this.text.storms);
      this.events.stormsIntroduced = true;
    }
  }

  update() {
    // Simplified update - no complex fading logic

    // Check for pending orange hint after blue task completion
    if (this.pendingOrangeHint && !this.hint && this.events.orangeSpawned) {
      this.showHint(this.text.orange);
      this.pendingOrangeHint = false;
    }

    // Update science fact timer
    if (this.factTimer > 0) {
      this.factTimer -= 1 / 60;
      if (this.factTimer <= 0) {
        this.scienceFact = "";
      }
    }
  }

  render(ctx) {
    // Render simple caption-style hint text below the orbitals
    if (this.hint) {
      ctx.save();

      // Position text lower to avoid overlap with larger orbital rings
      let textY = 500;

      // Add background for better readability
      ctx.font = "16px monospace";
      ctx.textAlign = "center";

      // Measure text for background
      let textWidth = ctx.measureText(this.hint).width;
      let padding = 12;
      let bgX = 500 - textWidth / 2 - padding;
      let bgY = textY - 18;
      let bgWidth = textWidth + padding * 2;
      let bgHeight = 24;

      // Dark background with slight transparency
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

      // Light text
      ctx.fillStyle = "rgba(200, 220, 255, 0.95)";
      ctx.fillText(this.hint, 500, textY);

      ctx.restore();
    } // Render science fact - bottom left, more compact
    if (this.scienceFact) {
      ctx.save();

      // Set font BEFORE measuring text
      ctx.font = "11px monospace";
      let factWidth = Math.min(
        450,
        ctx.measureText(this.scienceFact).width + 30
      );

      ctx.fillStyle = "rgba(40,20,60,0.85)";
      ctx.fillRect(20, 545, factWidth, 25);
      ctx.strokeStyle = "rgba(255,170,0,0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(20, 545, factWidth, 25);

      ctx.fillStyle = "rgba(255,170,0,0.95)";
      ctx.fillText(this.scienceFact, 30, 560);
      ctx.restore();
    } // Render help overlay
    if (this.helpVisible) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fillRect(0, 0, 1200, 900);

      let boxW = 450,
        boxH = 320,
        boxX = 275,
        boxY = 215;
      ctx.fillStyle = "rgba(20,30,50,0.95)";
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = "rgba(105,159,255,1)";
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = "rgba(255,200,100,1)";
      ctx.font = "16px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Game Rules", boxX + boxW / 2, boxY + 30);

      ctx.font = "12px monospace";
      ctx.textAlign = "left";

      // Tutorial progress section
      ctx.fillStyle = "rgba(255,200,100,0.8)";
      ctx.fillText("Tutorial Progress:", boxX + 20, boxY + 60);

      let tutorialTips = [
        {
          text: "Blue s-electrons attracted to cursor",
          completed: this.events.blueSpawned,
        },
        {
          text: "Orange p-electrons repelled by cursor",
          completed: this.events.orangeSpawned,
        },
        {
          text: "Follow Aufbau principle: fill lower energy first",
          completed: this.events.fullOrbital,
        },
        {
          text: "Hit occupied orbitals twice to eject electrons",
          completed: this.events.ejection,
        },
        {
          text: "Storms create navigation challenges",
          completed: this.events.stormsIntroduced,
        },
      ];

      tutorialTips.forEach((tip, i) => {
        ctx.fillStyle = tip.completed
          ? "rgba(100,255,100,0.9)"
          : "rgba(120,120,120,0.6)";
        let symbol = tip.completed ? "✓" : "○";
        ctx.fillText(`${symbol} ${tip.text}`, boxX + 30, boxY + 85 + i * 18);
      });

      // Game rules section
      ctx.fillStyle = "rgba(200,200,200,0.9)";
      ctx.fillText("Controls:", boxX + 20, boxY + 185);

      let controls = [
        "• Press M to Mute",
        "• Press L for Log",
        "• Press Esc for Rules",
      ];

      controls.forEach((line, i) => {
        ctx.fillText(line, boxX + 30, boxY + 205 + i * 16);
      });

      ctx.fillStyle = "rgba(100,200,255,0.8)";
      ctx.textAlign = "center";
      ctx.fillText("Press ESC to close", boxX + boxW / 2, boxY + boxH - 20);

      ctx.restore();
    }

    // Render element log overlay
    if (this.logVisible) {
      ctx.save();

      // Dark background with galaxy visible
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, 0, 1000, 750);

      // Title
      ctx.fillStyle = "rgba(255,200,100,1)";
      ctx.font = "24px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Element Log", 500, 80);

      // Get current unlocked level (completed + 1)
      let unlockedCount = (this.g?.o?.l || 0) + 1;
      if (this.g?.o?.cycle > 0) unlockedCount = 6; // All unlocked in infinite mode

      // Draw element cards in 2x3 grid
      let cardWidth = 200;
      let cardHeight = 120;
      let spacing = 40;
      let startX = (1000 - (cardWidth * 3 + spacing * 2)) / 2;
      let startY = 120;

      this.elements.forEach((element, i) => {
        let col = i % 3;
        let row = Math.floor(i / 3);
        let x = startX + col * (cardWidth + spacing);
        let y = startY + row * (cardHeight + spacing * 1.5);

        let isUnlocked = i < unlockedCount;
        let alpha = isUnlocked ? 1 : 0.3;

        // Card background
        ctx.fillStyle = `rgba(20,30,50,${alpha * 0.9})`;
        ctx.fillRect(x, y, cardWidth, cardHeight);

        // Card border with element color
        if (isUnlocked) {
          ctx.strokeStyle = `rgba(${element.color[0]},${element.color[1]},${element.color[2]},0.8)`;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, cardWidth, cardHeight);

          // Glow effect for unlocked
          ctx.shadowColor = `rgba(${element.color[0]},${element.color[1]},${element.color[2]},0.6)`;
          ctx.shadowBlur = 10;
          ctx.strokeRect(x, y, cardWidth, cardHeight);
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = "rgba(80,80,80,0.5)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cardWidth, cardHeight);
        }

        // Element symbol
        ctx.font = "36px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${element.color[0]},${element.color[1]},${element.color[2]},${alpha})`;
        ctx.fillText(element.symbol, x + cardWidth / 2, y + 45);

        // Element name
        ctx.font = "14px monospace";
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
        ctx.fillText(element.name, x + cardWidth / 2, y + 70);

        // Fact (only for unlocked)
        if (isUnlocked) {
          ctx.font = "10px monospace";
          ctx.fillStyle = `rgba(200,200,200,${alpha * 0.8})`;
          // Wrap text if needed
          let words = element.fact.split(" ");
          let line = "";
          let lineHeight = 12;
          let maxWidth = cardWidth - 20;
          let currentY = y + 90;

          for (let word of words) {
            let testLine = line + word + " ";
            let testWidth = ctx.measureText(testLine).width;
            if (testWidth > maxWidth && line !== "") {
              ctx.fillText(line.trim(), x + cardWidth / 2, currentY);
              line = word + " ";
              currentY += lineHeight;
            } else {
              line = testLine;
            }
          }
          ctx.fillText(line.trim(), x + cardWidth / 2, currentY);
        } else {
          ctx.font = "12px monospace";
          ctx.fillStyle = "rgba(120,120,120,0.6)";
          ctx.fillText("Locked", x + cardWidth / 2, y + 95);
        }
      });

      // Instructions
      ctx.fillStyle = "rgba(100,200,255,0.8)";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Press L or ESC to close", 500, 700);

      ctx.restore();
    }
  }
}
