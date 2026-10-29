export function create(engine, card) {
  const P = card?.engine_palette || { bg: 2, fg: 24, accent1: 9, accent2: 10, ui: 7 };
  const vibe = card?.vibe || "sunset";
  const heroName = String(card?.hero?.short || "HERO").slice(0, 10).toUpperCase();

  // 14x13 6-color dark-outlined sneaker-coin Pip hero (2-frame run stride)
  const heroPal = { o: 16, r: P.accent1, y: P.accent2, w: 7, k: 16, s: 8 };
  const heroRun1 = engine.sprite(`
    ....oooooo....
    ..oorrrrrroo..
    .orryyyyyyrro.
    orywkyyyywkyro
    orykkyyyykkyro
    orwyyyyyyyywro
    oryyyykkyyyyro
    .oryyyyyyyyro.
    ..oorrrrrroo..
    ...oooooooo...
    ..osss..ooo...
    ..oooo..osss..
    ........oooo..
  `, heroPal);
  const heroRun2 = engine.sprite(`
    ....oooooo....
    ..oorrrrrroo..
    .orryyyyyyrro.
    orywkyyyywkyro
    orykkyyyykkyro
    orwyyyyyyyywro
    oryyyyyyyyyyro
    .oryyykkyyyro.
    ..oorrrrrroo..
    ...oooooooo...
    ...ooo..ssso..
    ..ssso..oooo..
    ..oooo........
  `, heroPal);

  // 2-frame flaming meteor hazard, glowing plasma seeker, 2-frame star & shield
  const meteorPal = { o: 16, b: P.fg, r: 8, f: 9, y: 10, w: 7 };
  const meteor1 = engine.sprite([
    "...oyyo...", "..oyffyo..", ".offrrffo.", ".ofrwwrfo.", "oobrrrrboo",
    "obrwrrwrbo", "obrrrrrrbo", "obrrwwrrbo", ".obrrrrbo.", "..oooooo..",
  ].join("\n"), meteorPal);
  const meteor2 = engine.sprite([
    "..oy..yo..", ".oyfyyfyo.", ".offrrffo.", ".ofrwwrfo.", "oobrrrrboo",
    "obrrwwrrbo", "obrrrrrrbo", "obrwrrwrbo", ".obrrrrbo.", "..oooooo..",
  ].join("\n"), meteorPal);
  const seekerSpr = engine.sprite([
    "..oooooo..", ".occcccco.", "ocwccccwco", "ocwwkkwwco", "ockwwwwkco",
    "ocwwkkwwco", "ocwccccwco", ".occcccco.", "..oo..oo..",
  ].join("\n"), { o: 16, c: 12, w: 7, k: P.accent1 });
  const starSpr1 = engine.sprite([
    "...oo...", "..oyyo..", ".oywwyo.", "oywwwwyo", ".oywwyo.", "..oyyo..", "...oo...",
  ].join("\n"), { o: 16, y: P.accent2, w: 7 });
  const starSpr2 = engine.sprite([
    "...oo...", "..oyyo..", "..oywo..", ".oywwyo.", "..oywo..", "..oyyo..", "...oo...",
  ].join("\n"), { o: 16, y: P.accent2, w: 7 });
  const shieldSpr = engine.sprite([
    "..oooo..", ".occcco.", "ocwwwwco", "ocwccwco", "ocwccwco", "ocwwwwco", ".occcco.", "..oooo..",
  ].join("\n"), { o: 16, c: 12, w: 7 });

  let x = 148, facingLeft = false, lives = 3, inv = 0, hasShield = false;
  let dashTimer = 0, dashCd = 0, dashDir = 1, ghostTimer = 0;
  let spawn = 0.25, starSpawn = 0.7, spawnCount = 0, starCount = 0;
  let rocks = [], stars = [], particles = [], popups = [], ghosts = [];
  engine.lives(lives);

  function burst(px, py, col, n) {
    for (let i = 0; i < n; i++) {
      const a = engine.rng() * 6.28, s = 25 + engine.rng() * 75;
      particles.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, life: 0.22 + engine.rng() * 0.2, col });
    }
  }
  function addPopup(txt, px, py, col) {
    popups.push({ txt, x: Math.max(24, Math.min(296, px)), y: py, col, life: 0.55 });
  }

  return {
    update(dt, input) {
      const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (move !== 0) facingLeft = move < 0;
      if (dashCd > 0) dashCd -= dt;
      if ((input.pressed.a || input.pressed.b) && dashCd <= 0) {
        dashTimer = 0.14; dashCd = 0.65;
        dashDir = move !== 0 ? move : (facingLeft ? -1 : 1);
        facingLeft = dashDir < 0;
        engine.sfx("jump");
        burst(x + 14, 158, 7, 6);
      }
      if (dashTimer > 0) {
        dashTimer -= dt;
        x += dashDir * 320 * dt;
        ghostTimer -= dt;
        if (ghostTimer <= 0) {
          ghosts.push({ x, y: 142, flipX: facingLeft, life: 0.16 });
          if (ghosts.length > 3) ghosts.shift();
          ghostTimer = 0.04;
        }
      } else {
        x += move * 150 * dt;
      }
      x = Math.max(8, Math.min(284, x));

      spawn -= dt;
      if (spawn <= 0) {
        spawnCount++;
        let rx = engine.rngInt(10, engine.time < 5.2 ? 252 : 288);
        if (engine.time < 3.4 && Math.abs(rx - x) < 28) rx = (rx + 72) % 248 + 10;
        else if (engine.time > 5.6 && spawnCount % 5 === 0) rx = Math.max(10, Math.min(288, x + engine.rngInt(-8, 8)));
        const isCrusher = engine.time > 15 && spawnCount % 7 === 0;
        const isSeeker = !isCrusher && engine.time > 8 && spawnCount % 3 === 0;
        const kind = isCrusher ? 2 : isSeeker ? 1 : 0;
        const v = isCrusher ? 225 : 68 + Math.min(95, engine.time * 2.3);
        rocks.push({ x: rx, y: isCrusher ? 18 : -18, v, kind, warn: isCrusher ? 0.55 : 0, grazed: false });
        spawn = Math.max(0.18, 0.62 - engine.time / 95);
      }

      starSpawn -= dt;
      if (starSpawn <= 0) {
        starCount++;
        const isShield = starCount % 4 === 0 && !hasShield;
        let sx = engine.rngInt(18, 286);
        if (isShield && Math.abs(sx - x) < 28) sx = (sx + 80) % 260 + 18;
        stars.push({ x: sx, y: -14, v: 74, isShield });
        starSpawn = 0.9 + engine.rng() * 0.65;
      }

      if (inv > 0) inv -= dt;
      for (const r of rocks) {
        if (r.warn > 0) { r.warn -= dt; continue; }
        r.y += r.v * dt;
        if (r.kind === 1 && r.y < 145) r.x += Math.sign((x + 4) - r.x) * 48 * dt;
        const hitW = r.kind === 2 ? 20 : 14;
        const dist = Math.abs((r.x + (r.kind === 2 ? 15 : 10)) - (x + 14));
        if (r.y > 138 && r.y < 172 && dist < hitW) {
          if (dashTimer <= 0 && inv <= 0) {
            if (hasShield) {
              hasShield = false; inv = 0.85; r.y = 220;
              engine.sfx("hit"); engine.shake(4, 1);
              burst(x + 14, 156, 12, 12); addPopup("SHIELD BREAK", x + 14, 138, 12);
            } else {
              lives--; inv = 1.35; r.y = 220;
              engine.lives(lives); engine.sfx("hit"); engine.shake(8, 2);
              burst(x + 14, 156, 8, 12);
              if (lives <= 0) engine.gameOver(`${heroName} SQUASHED`);
            }
          }
        } else if (!r.grazed && r.y > 162 && dist < hitW + 13) {
          r.grazed = true;
          engine.score(5); engine.sfx("select");
          burst(x + 14, 152, P.accent2, 5); addPopup("CLOSE +5", x + 14, 138, P.accent2);
        }
        if (r.kind === 2 && r.y >= 156 && !r.shook) {
          r.shook = true; engine.shake(5, 2); burst(r.x + 12, 166, 9, 8);
        }
      }
      rocks = rocks.filter((r) => r.y < 194);

      stars = stars.filter((s) => {
        s.y += s.v * dt;
        if (Math.abs((s.x + 8) - (x + 14)) < 17 && s.y > 138 && s.y < 180) {
          if (s.isShield) {
            hasShield = true; engine.score(20); engine.sfx("powerup");
            burst(s.x + 8, s.y + 8, 12, 10); addPopup("SHIELD!", x + 14, 136, 12);
          } else {
            engine.score(15); engine.sfx("coin");
            burst(s.x + 8, s.y + 8, P.accent2, 7); addPopup("+15", s.x + 8, s.y, 7);
          }
          return false;
        }
        return s.y < 194;
      });

      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 170 * dt; p.life -= dt; }
      particles = particles.filter((p) => p.life > 0);
      for (const pop of popups) { pop.y -= 24 * dt; pop.life -= dt; }
      popups = popups.filter((pop) => pop.life > 0);
      for (const gh of ghosts) gh.life -= dt;
      ghosts = ghosts.filter((gh) => gh.life > 0);
      if (engine.frame % 25 === 0) engine.score(1);
    },

    draw(g) {
      g.dither(0, 0, 320, 56, vibe === "cosmic" ? 16 : 17, P.bg, 1);
      g.dither(0, 56, 320, 56, P.bg, P.fg, 2);
      g.dither(0, 112, 320, 56, P.fg, P.accent1, 2);
      g.circ(160, 94, 34, P.accent1);
      g.circ(160, 94, 22, P.accent2);
      g.circ(160, 94, 12, 7);
      if (vibe === "cosmic") g.line(118, 100, 202, 88, 12);
      for (let hx = 0; hx < 320; hx += 4) {
        const hy = 138 + Math.round(Math.sin(hx * 0.03) * 10);
        g.rect(hx, hy, 4, 168 - hy, 18);
        g.rect(hx, hy, 4, 2, P.fg);
      }
      g.rect(0, 168, 320, 32, 16);
      g.rect(0, 168, 320, 5, vibe === "mint" ? 3 : P.accent1);
      g.rect(0, 168, 320, 2, vibe === "mint" ? 11 : P.accent2);

      for (const s of stars) {
        const spr = s.isShield ? shieldSpr : (((engine.frame >> 3) & 1) ? starSpr1 : starSpr2);
        g.spr(spr, s.x, s.y, { scale: 2 });
      }
      for (const r of rocks) {
        if (r.warn > 0) {
          if ((engine.frame >> 1) & 1) {
            g.line(r.x + 12, 20, r.x + 12, 166, 8);
            g.text("!", r.x + 12, 24, 8, { scale: 2, align: "center" });
          }
        } else {
          const mSpr = r.kind === 1 ? seekerSpr : (((engine.frame >> 2) & 1) ? meteor1 : meteor2);
          g.spr(mSpr, r.x, r.y, { scale: r.kind === 2 ? 3 : 2 });
        }
      }
      for (const gh of ghosts) g.spr(heroRun2, gh.x, gh.y, { scale: 2, flipX: gh.flipX });
      const heroSpr = ((engine.frame >> 2) & 1) && dashTimer <= 0 ? heroRun2 : heroRun1;
      if (inv <= 0 || (engine.frame % 6 < 3)) g.spr(heroSpr, x, 142, { scale: 2, flipX: facingLeft });
      if (hasShield) {
        g.circb(x + 14, 155, 15 + ((engine.frame >> 3) & 1), 12);
        g.circb(x + 14, 155, 13, 7);
      }
      for (const p of particles) g.rect(p.x, p.y, 2, 2, p.col);
      for (const pop of popups) g.text(pop.txt, pop.x, pop.y, pop.col, { align: "center" });
      engine.hud(g);
    },
  };
}
