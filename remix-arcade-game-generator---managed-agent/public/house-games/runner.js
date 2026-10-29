export function create(engine, card) {
  const P = card?.engine_palette || { bg: 2, fg: 25, accent1: 9, accent2: 10, ui: 7 };
  const vibe = card?.vibe || "sunset";
  const heroName = String(card?.hero?.short || "FOX").slice(0, 10).toUpperCase();

  // 16x13 6-color dark-outlined scarf-fox hero (2-frame run + airborne jump pose)
  const heroPal = { o: 16, r: P.accent1, d: P.fg, w: 7, k: 16, s: 12 };
  const heroRun1 = engine.sprite([
    "..........o..o..", ".........oro.oro", ".........orrrrro", "........ordkrrwo",
    "........orrrrwwk", ".oo.....owwwwwo.", "orro...ossssso..", "ordro.orrsrrrdo.",
    ".owrrrorrrrrrdo.", "..owrrrrrrrrddo.", "...ooddddddddoo.", "....orro..orro..",
    "....ooo...ooo...",
  ].join("\n"), heroPal);
  const heroRun2 = engine.sprite([
    "..........o..o..", ".........oro.oro", ".........orrrrro", "........ordkrrwo",
    "........orrrrwwk", ".oo.....owwwwwo.", ".orro..osssssso.", ".ordroorrsrrrdo.",
    "..owrrorrrrrrdo.", "...owrrrrrrrddo.", "....oodddddddoo.", "...orro....orro.",
    "...ooo.....ooo..",
  ].join("\n"), heroPal);
  const heroJump = engine.sprite([
    ".........o..o...", "........oro.oro.", "........orrrrro.", ".......ordkrrwo.",
    ".ooo...orrrrwwk.", "osssso.owwwwwo..", ".ooossorrrrrrdo.", ".orrddrrrrrrrdo.",
    "..owrrrrrrrrddo.", "...ooddddddddoo.", "..orro.....orro.", "..ooo......ooo..",
    "................",
  ].join("\n"), heroPal);

  // 2-frame rotating boulder, crate, 2-frame swooper drone, 2-frame spinning star
  const bldPal = { o: 16, b: 5, d: 21, l: 6, w: 7, r: P.fg };
  const boulder1 = engine.sprite([
    "..oooooo..", ".obllllbo.", "oblwwllbdo", "obllllbddo", "obbrlbbddo",
    "obbrrbbddo", "obbbbbdddo", ".obdddddo.", "..oooooo..", "..........",
  ].join("\n"), bldPal);
  const boulder2 = engine.sprite([
    "..oooooo..", ".obddddbo.", "obdllllbdo", "oblwwllbdd", "obllllbbrr",
    "obbbbbbrro", "obddddbbbo", ".obbbbbbo.", "..oooooo..", "..........",
  ].join("\n"), bldPal);
  const crateSpr = engine.sprite([
    "oooooooooo", "obwwwwwwbo", "obwrrrrwbo", "obwrwwrwbo", "obwrrrrwbo",
    "obwrwwrwbo", "obwrrrrwbo", "obwwwwwwbo", "obbbbbbbbo", "oooooooooo",
  ].join("\n"), { o: 16, b: P.fg, w: P.accent2, r: 4 });
  const dronePal = { o: 16, b: P.fg, c: P.accent1, w: 7, r: 8 };
  const drone1 = engine.sprite([
    "ooo......ooo", "occco..occco", ".oobbbbbboo.", "..obwrrwbo..",
    "..obrrrrbo..", "...oooooo...", "....o..o....", "............",
  ].join("\n"), dronePal);
  const drone2 = engine.sprite([
    "............", "ooo.oooo.ooo", ".occcccccco.", "..obwrrwbo..",
    "..obrrrrbo..", "...oooooo...", "...o....o...", "............",
  ].join("\n"), dronePal);
  const coin1 = engine.sprite([
    "..oooo..", ".oyyyyo.", "oywyywyo", "oywffyyo", "oywffyyo", "oyyyyyyo", ".oyyyyo.", "..oooo..",
  ].join("\n"), { o: 16, y: P.accent2, f: P.accent1, w: 7 });
  const coin2 = engine.sprite([
    "...oo...", "..oyyo..", "..oywo..", "..oyfo..", "..oywo..", "..oyyo..", "...oo...", "........",
  ].join("\n"), { o: 16, y: P.accent2, f: P.accent1, w: 7 });

  const GROUND_Y = 160;
  let y = GROUND_Y - 26, vy = 0, jumpsLeft = 2, slamming = false, lives = 3, inv = 0;
  let boostTimer = 0, boostCd = 0, ghostTimer = 0, combo = 0, obsCount = 0;
  let distAcc = 0, obsTimer = 1.85, starTimer = 0.25, scrollX = 0;
  let stars = [
    { x: 104, y: GROUND_Y - 22, baseY: GROUND_Y - 22, phase: 0 },
    { x: 156, y: GROUND_Y - 46, baseY: GROUND_Y - 46, phase: 1.5 },
    { x: 216, y: GROUND_Y - 22, baseY: GROUND_Y - 22, phase: 3.0 },
  ];
  let obstacles = [{ x: 280, y: GROUND_Y - 20, w: 20, h: 20, kind: 0 }];
  let particles = [], popups = [], ghosts = [];
  engine.lives(lives);

  function spawnParticles(px, py, col, count) {
    for (let i = 0; i < count; i++) {
      particles.push({ x: px, y: py, vx: (engine.rng() - 0.5) * 95, vy: -25 - engine.rng() * 75, life: 0.24 + engine.rng() * 0.2, col });
    }
  }
  function addPopup(txt, px, py, col) {
    popups.push({ txt, x: px, y: py, col, life: 0.55 });
  }

  return {
    update(dt, input) {
      if (boostCd > 0) boostCd -= dt;
      if (input.pressed.b && boostCd <= 0) {
        boostTimer = 0.24; boostCd = 0.9; inv = Math.max(inv, 0.24);
        engine.score(5); engine.sfx("jump");
        spawnParticles(52, y + 12, 12, 7); addPopup("SURGE +5", 64, y - 6, 12);
      }
      if (boostTimer > 0) {
        boostTimer -= dt; ghostTimer -= dt;
        if (ghostTimer <= 0) {
          ghosts.push({ x: 36, y, life: 0.14 });
          if (ghosts.length > 3) ghosts.shift();
          ghostTimer = 0.04;
        }
      }
      const baseSpeed = 112 + Math.min(108, engine.time * 2.4);
      const speed = baseSpeed + (boostTimer > 0 ? 95 : 0);
      scrollX += speed * dt;
      distAcc += speed * dt;
      if (distAcc >= 35) { distAcc -= 35; engine.score(1); }

      const grounded = y >= GROUND_Y - 26;
      if (grounded) {
        if (slamming) {
          slamming = false; engine.shake(3, 1);
          spawnParticles(56, GROUND_Y - 2, P.accent2, 9);
        }
        y = GROUND_Y - 26; vy = 0; jumpsLeft = 2;
      }

      const wantJump = input.pressed.up || input.pressed.a || (grounded && (input.up || input.a));
      if (wantJump && jumpsLeft > 0) {
        vy = jumpsLeft === 2 ? -225 : -195;
        jumpsLeft--; slamming = false;
        engine.sfx("jump");
        spawnParticles(56, y + 22, P.ui, 5);
      } else if (!grounded && input.pressed.down && !slamming) {
        vy = 290; slamming = true; engine.sfx("select");
      }

      const grav = (vy < 0 && (input.up || input.a)) ? 430 : 640;
      vy += grav * dt;
      y = Math.min(GROUND_Y - 26, y + vy * dt);

      starTimer -= dt;
      if (starTimer <= 0) {
        const sy = engine.rng() < 0.55 ? GROUND_Y - 50 : GROUND_Y - 22;
        stars.push({ x: 332, y: sy, baseY: sy, phase: engine.rng() * 6.28 });
        starTimer = 0.52 + engine.rng() * 0.42;
      }
      for (const s of stars) {
        s.x -= speed * dt;
        s.y = s.baseY + Math.sin(engine.time * 5 + s.phase) * 4;
      }

      obsTimer -= dt;
      if (obsTimer <= 0) {
        obsCount++;
        const isDrone = engine.time > 10 && obsCount % 4 === 0;
        const isTall = !isDrone && engine.time > 7 && obsCount % 3 === 0;
        const kind = isDrone ? 2 : isTall ? 1 : 0;
        const oy = isDrone ? GROUND_Y - 46 : isTall ? GROUND_Y - 40 : GROUND_Y - 20;
        obstacles.push({ x: 336, y: oy, w: isDrone ? 24 : 20, h: isDrone ? 14 : isTall ? 40 : 20, kind });
        obsTimer = Math.max(0.75, 1.5 - engine.time * 0.012 + engine.rng() * 0.3);
      }
      for (const o of obstacles) {
        o.x -= (speed + (o.kind === 0 ? 18 : o.kind === 2 ? 25 : 0)) * dt;
        if (o.kind === 2) o.y = GROUND_Y - 46 + Math.sin(engine.time * 6 + o.x * 0.03) * 4;
      }
      if (inv > 0) inv -= dt;

      const hx = 44, hy = y;
      stars = stars.filter((s) => {
        if (Math.abs(s.x - (hx + 12)) < 18 && Math.abs(s.y - (hy + 10)) < 18) {
          combo = Math.min(4, combo + 1);
          const pts = 10 * combo;
          engine.score(pts); engine.sfx("coin");
          spawnParticles(s.x, s.y, P.accent2, 7);
          addPopup(combo > 1 ? `x${combo} +${pts}` : `+${pts}`, s.x, s.y - 4, combo > 1 ? P.accent2 : 7);
          return false;
        }
        if (s.x <= -18) { combo = 0; return false; }
        return true;
      });

      for (const o of obstacles) {
        if (inv <= 0 && hx + 24 > o.x + 3 && hx + 4 < o.x + o.w - 3 && hy + 24 > o.y + 3 && hy + 4 < o.y + o.h) {
          lives--; inv = 1.45; combo = 0;
          engine.lives(lives); engine.sfx("hit"); engine.shake(8, 2);
          spawnParticles(hx + 12, hy + 12, P.fg, 10);
          if (lives <= 0) engine.gameOver(`${heroName} WIPED OUT`);
        }
      }
      obstacles = obstacles.filter((o) => o.x > -28);

      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.life -= dt; }
      particles = particles.filter((p) => p.life > 0);
      for (const pop of popups) { pop.y -= 22 * dt; pop.life -= dt; }
      popups = popups.filter((pop) => pop.life > 0);
      for (const gh of ghosts) { gh.x -= 60 * dt; gh.life -= dt; }
      ghosts = ghosts.filter((gh) => gh.life > 0);
    },

    draw(g) {
      g.dither(0, 0, 320, 48, vibe === "cosmic" ? 16 : 17, P.bg, 1);
      g.dither(0, 48, 320, 48, P.bg, P.fg, 2);
      g.dither(0, 96, 320, 64, P.fg, P.accent1, 2);
      g.circ(232, 106, 34, P.accent1);
      g.circ(232, 106, 24, P.accent2);
      g.circ(232, 106, 14, 7);
      for (let i = 0; i < 16; i++) {
        const sx = ((i * 53 - (scrollX * 0.12) | 0) % 320 + 320) % 320;
        g.pset(sx, 22 + ((i * 19) % 44), i % 2 === 0 ? 7 : P.accent2);
      }
      for (let x = 0; x < 320; x += 4) {
        const fh = 116 + Math.round(Math.sin((x + scrollX * 0.25) * 0.025) * 12);
        g.rect(x, fh, 4, GROUND_Y - fh, P.bg);
        g.rect(x, fh, 4, 2, P.fg);
        const nh = 134 + Math.round(Math.sin((x + scrollX * 0.5) * 0.035 + 2) * 9);
        g.rect(x, nh, 4, GROUND_Y - nh, 18);
        g.rect(x, nh, 4, 2, P.accent1);
      }
      const turfTop = vibe === "cosmic" ? 12 : vibe === "candy" ? 14 : vibe === "mint" ? 11 : P.accent2;
      const turfMid = vibe === "cosmic" ? 28 : vibe === "candy" ? 15 : vibe === "mint" ? 3 : P.accent1;
      g.rect(0, GROUND_Y, 320, 40, vibe === "cosmic" ? 17 : 18);
      g.rect(0, GROUND_Y, 320, 6, turfMid);
      g.rect(0, GROUND_Y, 320, 2, turfTop);
      for (let i = 0; i < 12; i++) {
        const tx = ((i * 32 - (scrollX | 0)) % 352 + 352) % 352 - 16;
        g.rect(tx, GROUND_Y + 12, 12, 3, vibe === "cosmic" ? 12 : 4);
        g.rect(tx + 14, GROUND_Y + 22, 8, 2, P.fg);
      }
      for (const s of stars) {
        g.spr(((engine.frame >> 3) & 1) ? coin1 : coin2, s.x, s.y, { scale: 2 });
      }
      for (const o of obstacles) {
        if (o.kind === 2) {
          g.spr(((engine.frame >> 2) & 1) ? drone1 : drone2, o.x, o.y, { scale: 2 });
        } else if (o.kind === 1) {
          g.spr(crateSpr, o.x, GROUND_Y - 20, { scale: 2 });
          g.spr(crateSpr, o.x, GROUND_Y - 40, { scale: 2 });
        } else {
          g.spr(((engine.frame >> 2) & 1) ? boulder1 : boulder2, o.x, o.y, { scale: 2 });
        }
      }
      for (const gh of ghosts) g.spr(heroJump, gh.x, gh.y, { scale: 2 });
      if (inv <= 0 || engine.frame % 6 < 3) {
        const hSpr = y < GROUND_Y - 27 ? heroJump : (((engine.frame / 5) | 0) % 2 === 0 ? heroRun1 : heroRun2);
        g.spr(hSpr, 44, y, { scale: 2 });
      }
      for (const p of particles) g.rect(p.x, p.y, 2, 2, p.col);
      for (const pop of popups) g.text(pop.txt, pop.x, pop.y, pop.col, { align: "center" });
      engine.hud(g);
    },
  };
}
