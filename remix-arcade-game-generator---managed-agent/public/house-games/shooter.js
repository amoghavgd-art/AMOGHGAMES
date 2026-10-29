export function create(engine, card) {
  const P = card?.engine_palette || { bg: 17, fg: 28, accent1: 12, accent2: 14, ui: 7 };
  const heroName = String(card?.hero?.short || "SHIP").slice(0, 10).toUpperCase();

  // 11x10 6-color dark-outlined starfighter (2-frame thruster animation)
  const shipPal = { o: 16, c: P.accent1, b: P.fg, w: 7, f: 9, y: P.accent2 };
  const ship1 = engine.sprite([".....o.....","....owo....","...ocwco...","..ocwwwco..",".obcwwwcbo.","obbcwwwcbbo","obwwwwwwwbo","obbyyyyybbo",".oo.ofo.oo.","....oyo...."].join("\n"), shipPal);
  const ship2 = engine.sprite([".....o.....","....owo....","...ocwco...","..ocwwwco..",".obcwwwcbo.","obbcwwwcbbo","obwwwwwwwbo","obbyyyyybbo",".oo.oyo.oo.","...of.fo..."].join("\n"), shipPal);

  // 2-frame pulsing space jelly, kamikaze diver, 15x11 Armored Dreadnought Mini-Boss
  const jellyPal = { o: 16, f: P.fg, c: P.accent2, w: 7, k: 16 };
  const jelly1 = engine.sprite(["..ooooooo..",".offwwwffo.","offfffffffo","offwkffkwfo","occccccccco",".oc.ccc.co.",".o..o.o..o.","...o...o..."].join("\n"), jellyPal);
  const jelly2 = engine.sprite(["..ooooooo..",".offwwwffo.","offfffffffo","offwkffkwfo","occccccccco",".occ.c.cco.","..o..o..o..",".o.......o."].join("\n"), jellyPal);
  const diverSpr = engine.sprite(["...oyo...","..offfo..",".orrrrro.","orrwwwrro","orrrwrrro",".orrrrro.","..or.ro..","..o...o..","...o.o..."].join("\n"), { o: 16, r: 8, f: 9, y: P.accent2, w: 7 });
  const bossSpr = engine.sprite([
    "..ooooooooooo..", ".obbbbbbbbbbbo.", "obbccyyyyyccbbo", "obcwwrrrrrwwcbo",
    "obcwrrrrrrrwcbo", "obbbbbbbbbbbbbo", ".obyybbbbbbybo.", ".ob.obbbbbo.bo.",
    "..o..ob.bo..o..", ".....o...o.....", ".....oo.oo.....",
  ].join("\n"), { o: 16, b: P.fg, c: P.accent1, y: P.accent2, r: 8, w: 7 });
  const cellSpr = engine.sprite(["..oooo..",".occcco.","ocwwwwco","ocwwwwco",".occcco.","..oooo.."].join("\n"), { o: 16, c: P.accent2, w: 7 });

  let x = 149, y = 166, lives = 3, inv = 0, fireCd = 0, spreadTimer = 0;
  let waveTimer = 1.6, cellTimer = 2.0, waveNum = 1, waveCleared = false, empRadius = 0, empCd = 0;
  let bullets = [], eBullets = [], particles = [], popups = [], cells = [{ x: 152, y: 72, vy: 42 }];
  let enemies = [
    { x: 150, baseX: 150, y: 24, vy: 26, phase: 0, hp: 1, maxHp: 1, kind: 0, fireCd: 1.5, flash: 0 },
    { x: 104, baseX: 104, y: 16, vy: 28, phase: 1.5, hp: 1, maxHp: 1, kind: 0, fireCd: 1.9, flash: 0 },
    { x: 196, baseX: 196, y: 16, vy: 28, phase: 3.0, hp: 1, maxHp: 1, kind: 0, fireCd: 2.2, flash: 0 },
  ];
  engine.lives(lives);

  function explode(px, py, col, n) {
    for (let i = 0; i < n; i++) {
      const ang = engine.rng() * 6.283, spd = 20 + engine.rng() * 80;
      particles.push({ x: px, y: py, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.2 + engine.rng() * 0.25, col });
    }
  }
  function addPopup(txt, px, py, col) {
    popups.push({ txt, x: Math.max(28, Math.min(292, px)), y: py, col, life: 0.6 });
  }

  return {
    update(dt, input) {
      x = Math.max(8, Math.min(290, x + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 140 * dt));
      y = Math.max(40, Math.min(176, y + ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * 135 * dt));
      if (spreadTimer > 0) spreadTimer -= dt;
      if (inv > 0) inv -= dt;
      if (empCd > 0) empCd -= dt;

      if (input.pressed.b && empCd <= 0) {
        empCd = 3.2; empRadius = 6;
        engine.sfx("powerup"); engine.shake(4, 1); addPopup("EMP PULSE", x + 11, y - 6, 12);
      }
      if (empRadius > 0) {
        empRadius += 230 * dt;
        eBullets = eBullets.filter((eb) => {
          if (Math.hypot(eb.x - (x + 11), eb.y - (y + 10)) <= empRadius + 6) {
            engine.score(2); explode(eb.x, eb.y, 12, 3); return false;
          }
          return true;
        });
        if (empRadius > 88) empRadius = 0;
      }

      fireCd -= dt;
      const activeMove = input.a || input.b || input.left || input.right || input.up || input.down;
      if (fireCd <= 0 && activeMove) {
        bullets.push({ x: x + 11, y: y - 4, vx: 0, vy: -245 });
        if (spreadTimer > 0) bullets.push({ x: x + 5, y: y - 2, vx: -58, vy: -230 }, { x: x + 17, y: y - 2, vx: 58, vy: -230 });
        fireCd = 0.16; engine.sfx("shoot");
      }
      for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
      bullets = bullets.filter((b) => b.y > -10 && b.x > -10 && b.x < 330);

      waveTimer -= dt;
      if (waveTimer <= 0) {
        waveNum++; waveCleared = false;
        if (waveNum % 3 === 0) enemies.push({ x: 145, baseX: 145, y: -18, vy: 28, phase: 0, hp: 5, maxHp: 5, kind: 2, fireCd: 1.1, flash: 0 });
        const count = 2 + (engine.time > 14 ? 1 : 0), startX = engine.rngInt(36, 240);
        for (let i = 0; i < count; i++) {
          const ex = Math.max(20, Math.min(268, startX + (i - 1) * 44));
          const isDiver = engine.time > 10 && i === count - 1 && waveNum % 2 === 0;
          enemies.push({ x: ex, baseX: ex, y: -14 - i * 12, vy: isDiver ? 78 : 30 + Math.min(42, engine.time * 1.1), phase: engine.rng() * 6.28, hp: 1, maxHp: 1, kind: isDiver ? 1 : 0, fireCd: 0.9 + engine.rng() * 1.0, flash: 0 });
        }
        waveTimer = Math.max(0.95, 1.85 - engine.time * 0.014);
      }

      cellTimer -= dt;
      if (cellTimer <= 0) {
        cells.push({ x: engine.rngInt(24, 286), y: -10, vy: 45 });
        cellTimer = 3.2 + engine.rng() * 1.5;
      }
      for (const c of cells) c.y += c.vy * dt;
      cells = cells.filter((c) => {
        if (Math.abs(c.x - (x + 7)) < 15 && Math.abs(c.y - (y + 7)) < 15) {
          engine.score(25); spreadTimer = 6.0; engine.sfx("powerup");
          explode(c.x, c.y, P.accent2, 8); addPopup("SPREAD +25", c.x, c.y, P.accent2);
          return false;
        }
        return c.y < 208;
      });

      for (const e of enemies) {
        if (e.flash > 0) e.flash -= dt;
        if (e.kind === 2) {
          if (e.y < 30) e.y += e.vy * dt;
          else e.y += 6 * dt;
          e.x = Math.max(16, Math.min(274, 145 + Math.sin(engine.time * 2.0 + e.phase) * 76));
        } else if (e.kind === 1) {
          e.y += e.vy * dt;
          e.x += Math.sign(x - e.x) * 62 * dt;
        } else {
          e.y += e.vy * dt;
          e.x = Math.max(12, Math.min(284, e.baseX + Math.sin(engine.time * 3 + e.phase) * 24));
        }
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 14 && e.y < 142 && e.kind !== 1) {
          const dx = (x + 8) - (e.x + 8), dy = Math.max(36, (y + 8) - (e.y + 8));
          const len = Math.hypot(dx, dy) || 1, bspd = 92 + Math.min(48, engine.time);
          const vx = (dx / len) * bspd, vy = (dy / len) * bspd;
          eBullets.push({ x: e.x + 11, y: e.y + 12, vx, vy });
          if (e.kind === 2) {
            eBullets.push({ x: e.x + 6, y: e.y + 12, vx: vx - 34, vy }, { x: e.x + 18, y: e.y + 12, vx: vx + 34, vy });
          }
          e.fireCd = e.kind === 2 ? 1.15 : Math.max(0.9, 2.0 - engine.time * 0.01);
        }
      }

      for (const e of enemies) {
        const hitW = e.kind === 2 ? 16 : 11, hitH = e.kind === 2 ? 12 : 10;
        for (const b of bullets) {
          if (e.hp > 0 && b.y > -50 && Math.abs(b.x - (e.x + hitW - 2)) < hitW && Math.abs(b.y - (e.y + 8)) < hitH) {
            e.hp--; e.flash = 0.1; b.y = -99;
            if (e.hp <= 0) {
              const pts = e.kind === 2 ? 100 : e.kind === 1 ? 25 : 15;
              engine.score(pts); engine.sfx("explode");
              explode(e.x + 10, e.y + 8, e.kind === 2 ? 8 : P.accent1, e.kind === 2 ? 16 : 10);
              if (e.kind === 2) {
                engine.shake(6, 2); cells.push({ x: e.x + 8, y: e.y + 6, vy: 46 });
                addPopup("BOSS +100", e.x + 14, e.y, P.accent2);
              } else if (engine.rng() < 0.25) {
                cells.push({ x: e.x + 4, y: e.y + 4, vy: 48 });
              }
            } else {
              engine.sfx("hit");
            }
          }
        }
      }

      function hitPlayer() {
        if (inv > 0) return;
        lives--; inv = 1.5;
        engine.lives(lives); engine.sfx("hit"); engine.shake(8, 2);
        explode(x + 10, y + 8, P.fg, 10);
        if (lives <= 0) engine.gameOver(`${heroName} LOST`);
      }

      for (const e of enemies) {
        if (inv <= 0 && e.hp > 0 && Math.abs((e.x + 10) - (x + 10)) < 13 && Math.abs((e.y + 8) - (y + 8)) < 12) {
          e.hp -= e.kind === 2 ? 1 : 99; hitPlayer();
        }
      }
      const killedOnFrame = enemies.some((e) => e.hp <= 0);
      enemies = enemies.filter((e) => e.hp > 0 && e.y < 210);
      if (killedOnFrame && enemies.length === 0 && !waveCleared) {
        waveCleared = true; engine.score(50);
        addPopup("WAVE CLEAR +50", 160, 86, P.accent2);
      }

      for (const eb of eBullets) { eb.x += eb.vx * dt; eb.y += eb.vy * dt; }
      eBullets = eBullets.filter((eb) => {
        if (Math.abs(eb.x - (x + 10)) < 8 && Math.abs(eb.y - (y + 9)) < 8) {
          hitPlayer(); return false;
        }
        return eb.y < 208 && eb.y > -10 && eb.x > -10 && eb.x < 330;
      });

      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      particles = particles.filter((p) => p.life > 0);
      for (const pop of popups) { pop.y -= 22 * dt; pop.life -= dt; }
      popups = popups.filter((pop) => pop.life > 0);
    },

    draw(g) {
      g.cls(16);
      g.dither(0, 0, 320, 72, 16, P.bg, 1);
      g.dither(0, 72, 320, 72, P.bg, 17, 1);
      g.dither(0, 144, 320, 56, 17, P.fg, 1);
      g.circ(248, 56, 22, P.fg);
      g.circ(248, 56, 16, P.accent2);
      g.line(218, 62, 278, 50, P.accent1);

      for (let i = 0; i < 32; i++) {
        const sx = (i * 73) % 320, spd = (i % 3) + 1;
        const sy = ((i * 41 + engine.frame * spd) % 200) | 0;
        g.pset(sx, sy, spd === 3 ? 7 : P.accent1);
      }

      for (const c of cells) g.spr(cellSpr, c.x, c.y, { scale: 2 });
      for (const e of enemies) {
        const spr = e.kind === 2 ? bossSpr : e.kind === 1 ? diverSpr : (((engine.frame >> 3) & 1) ? jelly1 : jelly2);
        g.spr(spr, e.x, e.y, { scale: 2, flash: e.flash > 0 ? 7 : undefined });
        if (e.kind === 2) {
          g.rect(e.x, e.y - 5, 30, 3, 16);
          g.rect(e.x, e.y - 5, Math.round((30 * e.hp) / e.maxHp), 3, e.flash > 0 ? 7 : 8);
        }
      }

      for (const b of bullets) g.rect(b.x - 1, b.y, 2, 6, P.accent2);
      for (const eb of eBullets) {
        g.circ(eb.x, eb.y, 2, 8);
        g.pset(eb.x, eb.y, 7);
      }
      if (empRadius > 0) {
        g.circb(x + 11, y + 10, empRadius | 0, 12);
        g.circb(x + 11, y + 10, Math.max(1, (empRadius - 3) | 0), 7);
      }
      if (inv <= 0 || engine.frame % 6 < 3) {
        g.spr(((engine.frame >> 2) & 1) ? ship1 : ship2, x, y, { scale: 2 });
      }
      for (const p of particles) g.rect(p.x, p.y, 2, 2, p.col);
      for (const pop of popups) g.text(pop.txt, pop.x, pop.y, pop.col, { align: "center" });
      engine.hud(g);
    },
  };
}
