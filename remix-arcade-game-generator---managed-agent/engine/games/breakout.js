export function create(engine, card) {
  const P = card?.engine_palette || { bg: 18, fg: 14, accent1: 15, accent2: 10, ui: 7 };
  const heroName = String(card?.hero?.short || "CUPCAKE").toUpperCase();
  const heroPal = { o: 16, k: 16, r: 8, w: 7, p: P.accent1, b: P.fg, t: P.accent2 };
  const hero1 = engine.sprite("....ooo....\n...orwro...\n..oopppoo..\n.opwpwpwpo.\nopptppptppo\nooooooooooo\nobwtbtbtwbo\nobokbtbkobo\n.obtbtbtbo.\n..ooooooo..", heroPal);
  const hero2 = engine.sprite("....ooo....\n...orrwo...\n..oopppoo..\n.opppwpppo.\noptppppptpo\nooooooooooo\nobtbtbtbtbo\nobtkbtbktbo\n.obtbtbtbo.\n..ooooooo..", heroPal);
  const dropMSpr = engine.sprite(".ooooooo.\nocwcccwco\nocwwcwwco\nocwcwcwco\nocwcccwco\noccccccco\n.ooooooo.", { o: 16, c: P.accent2, w: 7 });
  const dropWSpr = engine.sprite(".ooooooo.\nocwcccwco\nocwcccwco\nocwcwcwco\nocwwcwwco\noccccccco\n.ooooooo.", { o: 16, c: P.accent1, w: 7 });

  const COLS = 8, ROWS = 6, BW = 32, BH = 9, GAP = 3, OX = 22, OY = 28;
  const ROW_COLS = [P.ui, P.fg, P.accent1, P.accent2, P.fg, P.accent1];
  let stage = 1, bricks = [], drops = [], sparks = [], popups = [], combo = 0;

  function buildBricks() {
    bricks = [];
    const pat = (stage - 1) % 3;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (pat === 1 && r > 0 && r < 5 && (c === 3 || c === 4)) continue;
        if (pat === 2 && ((r + c) % 5 === 1) && r < 4) continue;
        const armored = r === 0 || (pat > 0 && r === 1 && (c + r) % 2 === 0);
        const hp = armored ? 2 : 1;
        bricks.push({
          x: OX + c * (BW + GAP), y: OY + r * (BH + GAP), w: BW, h: BH,
          col: armored ? 6 : ROW_COLS[r % ROW_COLS.length], hp, maxHp: hp, flash: 0, alive: true,
        });
      }
    }
  }
  buildBricks();

  let px = 136, wideTimer = 0, lives = 3, launchWait = 1.4, smashWin = 0;
  const py = 184;
  let balls = [{ x: 160, y: 178, vx: 78, vy: -145, stuck: true, pierce: 0 }];
  engine.lives(lives);

  function addSparks(sx, sy, col, n = 6) {
    for (let i = 0; i < n; i++) {
      sparks.push({ x: sx, y: sy, vx: (engine.rng() - 0.5) * 95, vy: (engine.rng() - 0.5) * 95, life: 0.24, col });
    }
  }
  const addPopup = (txt, x, y, col = 7) => popups.push({ txt, x, y, col, life: 0.6 });

  return {
    update(dt, input) {
      const pw = wideTimer > 0 ? 64 : 46;
      if (wideTimer > 0) wideTimer -= dt;
      if (smashWin > 0) smashWin -= dt;
      if (input.pressed.a || input.pressed.b || input.pressed.up) smashWin = 0.25;

      const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      px = Math.max(12, Math.min(308 - pw, px + move * 185 * dt));

      const launchKey = input.a || input.b || input.up || input.left || input.right || input.pressed.start;
      if (balls.some((b) => b.stuck)) {
        launchWait -= dt;
        const canManual = lives === 3 || launchWait < 1.1;
        for (const b of balls) {
          if (b.stuck) {
            b.x = px + pw / 2; b.y = py - 5;
            if ((launchKey && canManual) || launchWait <= 0) {
              b.stuck = false; b.vx = 85; b.vy = -148; b.pierce = 0; combo = 0;
              engine.sfx("select");
            }
          }
        }
      }

      for (const br of bricks) if (br.flash > 0) br.flash -= dt;

      for (const b of balls) {
        if (b.stuck) continue;
        b.x += b.vx * dt; b.y += b.vy * dt;

        if (b.x < 14) { b.x = 14; b.vx = Math.abs(b.vx); }
        else if (b.x > 306) { b.x = 306; b.vx = -Math.abs(b.vx); }
        if (b.y < 20) { b.y = 20; b.vy = Math.abs(b.vy); }

        if (b.vy > 0 && b.y + 3 >= py && b.y - 3 <= py + 7 && b.x + 3 >= px && b.x - 3 <= px + pw) {
          const hitOffset = (b.x - (px + pw / 2)) / (pw / 2);
          const adj = Math.abs(hitOffset) < 0.08 ? 0.35 : hitOffset;
          const smash = smashWin > 0;
          const spd = Math.min(220, Math.hypot(b.vx, b.vy) * (smash ? 1.1 : 1.02));
          b.vx = adj * spd * 0.78;
          b.vy = -Math.sqrt(Math.max(8500, spd * spd - b.vx * b.vx));
          b.y = py - 4; combo = 0;
          if (smash) {
            b.pierce = 1; smashWin = 0; engine.shake(3, 1);
            addSparks(b.x, py, 7, 8); addPopup("SMASH!", b.x, py - 14, 7);
          }
          engine.score(2); engine.sfx("jump");
        }

        for (const br of bricks) {
          if (!br.alive) continue;
          if (b.x + 3 > br.x && b.x - 3 < br.x + br.w && b.y + 3 > br.y && b.y - 3 < br.y + br.h) {
            combo++;
            const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
            if (b.pierce > 0) {
              br.alive = false; b.pierce--;
              const pts = br.maxHp === 2 ? 25 : Math.min(30, combo * 10);
              engine.score(pts); engine.sfx("explode");
              addSparks(cx, cy, 7, 9); addPopup("+" + pts, cx, br.y, 7);
            } else if (br.hp > 1) {
              br.hp--; br.flash = 0.14; b.vy = -b.vy;
              engine.score(10); engine.sfx("hit"); addSparks(cx, cy, 7, 5);
            } else {
              br.alive = false; b.vy = -b.vy;
              const pts = br.maxHp === 2 ? 25 : Math.min(30, combo * 10);
              engine.score(pts); engine.sfx("coin");
              addSparks(cx, cy, br.col, 7); addPopup("+" + pts, cx, br.y, br.maxHp === 2 ? 7 : P.accent2);
            }
            if (!br.alive && engine.rng() < 0.3) {
              drops.push({ x: cx - 8, y: br.y + 4, vy: 68, kind: engine.rng() < 0.5 ? "multi" : "wide" });
            }
            break;
          }
        }
      }

      if (bricks.every((br) => !br.alive)) {
        stage++; engine.score(100); engine.sfx("win");
        addPopup("STAGE " + stage, 160, 100, P.accent2); buildBricks();
        for (const b of balls) { if (b.y < 108) { b.y = 108; b.vy = Math.abs(b.vy); } }
      }

      for (const d of drops) d.y += d.vy * dt;
      drops = drops.filter((d) => {
        if (d.y + 12 >= py && d.y <= py + 8 && d.x + 16 >= px && d.x <= px + pw) {
          engine.score(25); engine.sfx("powerup");
          if (d.kind === "multi" && balls.length < 3) {
            const src = balls[0] || { x: px + pw / 2, y: py - 8 };
            balls.push({ x: src.x, y: src.y, vx: -95, vy: -140, stuck: false, pierce: 0 });
            addPopup("MULTI!", px + pw / 2, py - 14, P.accent2);
          } else {
            wideTimer = 8.0; addPopup("WIDE!", px + pw / 2, py - 14, P.accent1);
          }
          return false;
        }
        return d.y < 204;
      });

      balls = balls.filter((b) => b.y < 198);
      if (balls.length === 0) {
        lives--; combo = 0; engine.lives(lives); engine.sfx("hit"); engine.shake(8, 2);
        if (lives <= 0) {
          engine.gameOver(heroName + " OUT OF BALLS");
        } else {
          launchWait = 2.0;
          balls = [{ x: px + pw / 2, y: py - 5, vx: 88, vy: -145, stuck: true, pierce: 0 }];
        }
      }

      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
      sparks = sparks.filter((s) => s.life > 0);
      for (const p of popups) { p.y -= 18 * dt; p.life -= dt; }
      popups = popups.filter((p) => p.life > 0);
    },

    draw(g) {
      g.dither(0, 0, 320, 100, 18, P.bg, 1);
      g.dither(0, 100, 320, 100, P.bg, 17, 1);
      g.rectb(10, 20, 300, 178, P.fg);

      for (const br of bricks) {
        if (!br.alive) continue;
        const fill = br.flash > 0 ? 7 : br.col;
        g.rect(br.x, br.y, br.w, br.h, 16);
        g.rect(br.x + 1, br.y + 1, br.w - 2, br.h - 2, fill);
        g.rect(br.x + 2, br.y + 1, br.w - 4, 2, 7);
        if (br.maxHp === 2) {
          g.pset(br.x + 3, br.y + 4, 16); g.pset(br.x + br.w - 4, br.y + 4, 16);
          if (br.hp === 1) {
            g.line(br.x + 9, br.y + 1, br.x + 15, br.y + 7, 16);
            g.line(br.x + 15, br.y + 7, br.x + 21, br.y + 2, 7);
          }
        }
      }

      for (const d of drops) g.spr(d.kind === "multi" ? dropMSpr : dropWSpr, d.x, d.y, { scale: 2 });

      const pw = wideTimer > 0 ? 64 : 46;
      g.rect(px, py, pw, 7, 16);
      g.rect(px + 1, py + 1, pw - 2, 5, P.accent1);
      g.rect(px + 2, py + 1, pw - 4, 2, 7);
      g.spr((engine.frame >> 4) & 1 ? hero2 : hero1, px + pw / 2 - 11, py - 15, { scale: 2 });

      for (const b of balls) {
        if (!b.stuck) {
          for (let i = 3; i >= 1; i--) {
            const tx = b.x - b.vx * 0.014 * i, ty = b.y - b.vy * 0.014 * i;
            g.circ(tx, ty, 4 - i, i === 1 ? 7 : i === 2 ? P.accent1 : P.fg);
          }
        }
        g.circ(b.x, b.y, 4, 16);
        g.circ(b.x, b.y, 3, b.pierce > 0 ? 7 : P.accent2);
        g.pset(b.x - 1, b.y - 1, 7);
      }

      for (const s of sparks) g.rect(s.x, s.y, 2, 2, s.col);
      for (const p of popups) g.text(p.txt, p.x, p.y, p.col, { align: "center" });
      engine.hud(g);
    },
  };
}
