export function create(engine, card) {
  const P = card?.engine_palette || { bg: 19, fg: 27, accent1: 11, accent2: 15, ui: 7 };
  const heroName = String(card?.hero?.short || "SLIME").toUpperCase();
  const heroPal = { o: 16, k: 16, w: 7, g: P.accent1, h: P.accent2, m: P.fg };
  const slimeIdle = engine.sprite("....ooooo....\n..oohhhhhoo..\n.ohwwgggggho.\nohwgggggggggo\nogggwokggwkgo\nogggookggokgo\nogghgggggggho\nogggggmmggggo\nomgggggggggmo\n.ommmmmmmmmo.\n..ooooooooo..", heroPal);
  const slimeAir = engine.sprite("...ooooooo...\n..ohwwggggho.\n.ohwgggggggo.\n.oggwokggwkgo\n.oggookggokgo\n.ogghggggghgo\n.oggggmmggggo\n..omggggggmo.\n..ommmmmmmmo.\n...oo.oo.oo..\n...o..oo..o..", heroPal);
  const bPal = { o: 16, k: 16, f: P.fg, w: 7, r: P.accent2, a: P.accent1 };
  const beetle1 = engine.sprite("........ao..\n..ooooooaoo.\n.offwffffwfo\nofffrffffoko\nofffrffffwfo\nofffffffffoo\n.orrrrrrrro.\n.oo..oo..oo.", bPal);
  const beetle2 = engine.sprite(".........ao.\n..ooooooaoo.\n.offwffffwfo\nofffrffffoko\nofffrffffwfo\nofffffffffoo\n.orrrrrrrro.\n..oo..oo..o.", bPal);
  const gemSpr = engine.sprite("...oooo...\n..ocwwco..\n.ocwwwwco.\nocwccccaco\nocaccccaco\n.ocaaacco.\n..occcco..\n...oooo...", { o: 16, c: P.accent2, a: P.accent1, w: 7 });
  const flag1 = engine.sprite("oo.......\noaaaaao..\noawwhahao\noaaaaahao\noo...ooo.\noo.......\noo.......\noo.......\noooo.....", { o: 16, a: P.accent1, h: P.accent2, w: 7 });
  const flag2 = engine.sprite("oo.......\noaaaaoo..\noawwaaaho\noaaaaahoo\noo..oooo.\noo.......\noo.......\noo.......\noooo.....", { o: 16, a: P.accent1, h: P.accent2, w: 7 });

  const platforms = [
    { x: 16, y: 176, w: 288, baseX: 16, amp: 0, spd: 0 },
    { x: 32, y: 144, w: 96, baseX: 32, amp: 20, spd: 1.4 },
    { x: 184, y: 140, w: 100, baseX: 184, amp: 18, spd: -1.3 },
    { x: 88, y: 108, w: 128, baseX: 88, amp: 28, spd: 1.6 },
    { x: 24, y: 74, w: 92, baseX: 24, amp: 14, spd: 1.2 },
    { x: 192, y: 74, w: 92, baseX: 192, amp: 14, spd: -1.2 },
    { x: 112, y: 42, w: 96, baseX: 112, amp: 0, spd: 0 },
  ];

  let gems = [], sparks = [], popups = [], stage = 1;
  function spawnGems() {
    gems = [
      { x: 112, y: 156, collected: false }, { x: 186, y: 156, collected: false },
      { x: 76, y: 124, collected: false }, { x: 228, y: 120, collected: false },
      { x: 148, y: 88, collected: false }, { x: 64, y: 54, collected: false },
      { x: 236, y: 54, collected: false },
    ];
  }
  spawnGems();

  const beetles = [
    { platIdx: 0, offset: 220, dir: -1, spd: 52, dead: 0 },
    { platIdx: 3, offset: 24, dir: 1, spd: 44, dead: 0 },
    { platIdx: 5, offset: 30, dir: 1, spd: 48, dead: 0 },
  ];

  let hx = 148, hy = 154, vx = 0, vy = 0, wallVx = 0, dashCd = 0;
  let grounded = true, jumpsLeft = 2, facingLeft = false, lives = 3, inv = 0, lavaY = 198;
  engine.lives(lives);

  function burst(x, y, col, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + engine.rng() * 0.5;
      sparks.push({ x, y, vx: Math.cos(a) * 65, vy: Math.sin(a) * 65, life: 0.3, col });
    }
  }
  const addPopup = (txt, x, y, col = 7) => popups.push({ txt, x, y, col, life: 0.65 });

  return {
    update(dt, input) {
      if (inv > 0) inv -= dt;
      if (dashCd > 0) dashCd -= dt;
      wallVx *= Math.max(0, 1 - 5.5 * dt);

      for (const p of platforms) {
        const prevX = p.x;
        if (p.amp !== 0) p.x = p.baseX + Math.sin(engine.time * p.spd) * p.amp;
        p.dx = p.x - prevX;
      }

      const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (move !== 0) facingLeft = move < 0;
      if (input.pressed.b && dashCd <= 0) {
        dashCd = 0.85; wallVx = (facingLeft ? -1 : 1) * 175;
        vy = Math.min(vy, -90); engine.sfx("jump"); burst(hx + 12, hy + 12, P.accent2, 6);
      }
      vx = move * 125 + wallVx;

      const wallDir = !grounded ? (hx <= 7 ? 1 : hx >= 287 ? -1 : 0) : 0;
      if (wallDir !== 0 && vy > 0) {
        vy = Math.min(vy, 45);
        if (engine.frame % 4 === 0) {
          sparks.push({ x: wallDir > 0 ? 7 : 312, y: hy + 12, vx: wallDir * 22, vy: -18, life: 0.2, col: 7 });
        }
      }

      const wantJump = input.pressed.up || input.pressed.a || (grounded && (input.up || input.a));
      if (wallDir !== 0 && (input.pressed.up || input.pressed.a)) {
        vy = -215; vx = wallDir * 140; wallVx = vx; jumpsLeft = 1;
        facingLeft = wallDir < 0; engine.sfx("jump");
        burst(wallDir > 0 ? 8 : 310, hy + 12, 7, 6);
      } else if (wantJump && jumpsLeft > 0) {
        vy = jumpsLeft === 2 ? -218 : -192;
        grounded = false; jumpsLeft--; engine.sfx("jump");
      }

      vy += 520 * dt;
      hx = Math.max(6, Math.min(288, hx + vx * dt));
      const prevY = hy;
      hy += vy * dt;
      grounded = false;

      if (vy >= 0) {
        for (const p of platforms) {
          if (hx + 20 > p.x && hx + 4 < p.x + p.w && prevY + 22 <= p.y + 6 && hy + 22 >= p.y) {
            hy = p.y - 22; vy = 0; grounded = true; jumpsLeft = 2; hx += p.dx || 0;
            break;
          }
        }
      }

      for (const gm of gems) {
        if (!gm.collected && Math.abs(gm.x - (hx + 8)) < 16 && Math.abs(gm.y - (hy + 8)) < 16) {
          gm.collected = true; engine.score(15); engine.sfx("coin");
          burst(gm.x + 8, gm.y + 8, P.accent2, 5);
        }
      }

      const flagPlat = platforms[[6, 4, 5][(stage - 1) % 3]];
      const flagX = flagPlat.x + flagPlat.w / 2 - 8, flagY = flagPlat.y - 18;
      if (Math.abs(hx - flagX) < 18 && Math.abs(hy - flagY) < 20) {
        stage++; engine.score(50); engine.sfx("win"); spawnGems();
        vy = -175; jumpsLeft = 2; lavaY = Math.min(198, lavaY + 14);
        burst(flagX + 8, flagY + 8, P.accent2, 12); addPopup("STAGE " + stage, flagX + 8, flagY - 6, 7);
      }
      if (gems.every((gm) => gm.collected)) {
        engine.score(40); engine.sfx("powerup"); spawnGems(); addPopup("ALL GEMS +40", 160, 64, P.accent2);
      }

      function hurtHero(reason) {
        if (inv > 0) return;
        lives--; inv = 1.6; engine.lives(lives); engine.sfx("hit"); engine.shake(8, 2);
        vy = -155; burst(hx + 12, hy + 12, 8, 8);
        if (lives <= 0) engine.gameOver(heroName + " " + reason);
      }

      for (const b of beetles) {
        if (b.dead > 0) { b.dead -= dt; continue; }
        const p = platforms[b.platIdx];
        b.offset += b.dir * b.spd * dt;
        if (b.offset < 6) { b.offset = 6; b.dir = 1; }
        else if (b.offset > p.w - 24) { b.offset = p.w - 24; b.dir = -1; }
        b.x = p.x + b.offset; b.y = p.y - 16;

        if (Math.abs((b.x + 12) - (hx + 12)) < 15 && Math.abs((b.y + 8) - (hy + 11)) < 14) {
          if (vy > 20 && prevY + 18 <= b.y + 8) {
            b.dead = 3.5; vy = -195; jumpsLeft = 2;
            engine.score(30); engine.sfx("explode");
            burst(b.x + 12, b.y + 8, P.accent2, 10); addPopup("+30", b.x + 12, b.y - 4, 7);
          } else {
            hurtHero("STUNG");
          }
        }
      }

      if (engine.time > 8) lavaY = Math.max(152, lavaY - 3.0 * dt);
      if (hy + 20 >= lavaY) {
        hy = Math.min(hy, lavaY - 22);
        hurtHero("MELTED");
      }

      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
      sparks = sparks.filter((s) => s.life > 0);
      for (const p of popups) { p.y -= 18 * dt; p.life -= dt; }
      popups = popups.filter((p) => p.life > 0);
    },

    draw(g) {
      g.dither(0, 0, 320, 64, 17, P.bg, 1);
      g.dither(0, 64, 320, 72, P.bg, P.fg, 1);
      g.dither(0, 136, 320, 64, P.fg, 18, 2);
      g.circ(64, 54, 22, P.accent2); g.circ(64, 54, 14, 7);
      for (let i = 0; i < 6; i++) {
        const cx = (((i * 68 - (engine.time * 12) | 0) % 360) + 360) % 360 - 24, cy = 24 + (i % 3) * 16;
        g.rect(cx, cy, 26, 5, 7); g.rect(cx + 4, cy - 3, 16, 3, 7);
      }

      g.rect(0, 20, 6, 180, 16); g.rect(1, 20, 4, 180, P.fg);
      g.rect(314, 20, 6, 180, 16); g.rect(315, 20, 4, 180, P.fg);
      for (let wy = 24; wy < 196; wy += 14) {
        g.rect(1, wy, 4, 2, P.accent1); g.rect(315, wy, 4, 2, P.accent1);
      }

      for (const p of platforms) {
        g.rect(p.x, p.y, p.w, 9, 16);
        g.rect(p.x + 1, p.y + 1, p.w - 2, 4, P.fg);
        g.rect(p.x + 1, p.y, p.w - 2, 2, P.accent1);
        for (let tx = p.x + 6; tx < p.x + p.w - 6; tx += 12) g.rect(tx, p.y + 5, 4, 2, P.accent2);
      }

      const flagPlat = platforms[[6, 4, 5][(stage - 1) % 3]];
      g.spr((engine.frame >> 3) & 1 ? flag2 : flag1, flagPlat.x + flagPlat.w / 2 - 8, flagPlat.y - 18, { scale: 2 });
      for (const gm of gems) {
        if (!gm.collected) g.spr(gemSpr, gm.x, gm.y + Math.sin(engine.time * 5 + gm.x) * 2, { scale: 2 });
      }
      for (const b of beetles) {
        if (b.dead <= 0) g.spr((engine.frame >> 3) & 1 ? beetle2 : beetle1, b.x, b.y, { scale: 2, flipX: b.dir < 0 });
      }
      const hSpr = !grounded || (engine.frame >> 4) & 1 ? slimeAir : slimeIdle;
      if (inv <= 0 || engine.frame % 6 < 3) g.spr(hSpr, hx, hy, { scale: 2, flipX: facingLeft });

      const ly = lavaY | 0;
      g.rect(0, ly, 320, 200 - ly, 8);
      g.dither(0, ly, 320, 5, P.accent1, P.accent2, 2);
      for (let lx = 8; lx < 312; lx += 16) {
        const crest = Math.sin(engine.time * 5 + lx * 0.2) * 2;
        g.circ(lx, ly + crest, 3, P.accent2);
        if (crest < -0.8) g.pset(lx, ly - 3, 7);
      }
      for (const s of sparks) g.rect(s.x, s.y, 2, 2, s.col);
      for (const p of popups) g.text(p.txt, p.x, p.y, p.col, { align: "center" });
      engine.hud(g);
    },
  };
}
