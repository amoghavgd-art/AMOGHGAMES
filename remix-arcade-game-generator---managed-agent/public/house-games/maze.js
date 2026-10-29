export function create(engine, card) {
  const P = card?.engine_palette || { bg: 19, fg: 27, accent1: 11, accent2: 15, ui: 7 };
  const heroName = String(card?.hero?.short || "MOTH").toUpperCase();
  const heroPal = { o: 16, w: 7, b: P.fg, p: P.accent1, a: P.accent2, s: 12 };
  const hero1 = engine.sprite("..o.a..a.o..\n.obbboobbbo.\nobwwbppbwwbo\nobpbbaabbpbo\nobbbowwobbbo\n.obpsaaaspbo\n.obbbaabbbbo\n..obbpbbpbo.\n...oo.oo.o..\n....o..o....", heroPal);
  const hero2 = engine.sprite("....a..a....\n...oo..oo...\n..obboobbo..\n.obwwaawwbo.\nobpbbaabbpbo\nobbbowwobbbo\nobpsbaaaspbo\n.obbbaabbbbo\n..obbpbbpbo.\n...oo..oo...", heroPal);

  const mkGhost = (f) => [
    engine.sprite("..oooooo..\n.ohfffffo.\noffwffwffo\noffwffwffo\noffffffffo\noffsssfffo\nof.offo.fo\no..o..o..o", { o: 16, f, h: 7, s: P.bg, w: 7 }),
    engine.sprite("..oooooo..\n.ohfffffo.\noffwffwffo\noffwffwffo\noffffffffo\noffsssfffo\n.fo.oo.of.\n..o....o..", { o: 16, f, h: 7, s: P.bg, w: 7 }),
  ];
  const [ghostSpr1, ghostSpr2] = mkGhost(P.fg);
  const ghostSets = [[ghostSpr1, ghostSpr2], mkGhost(P.accent1), mkGhost(P.accent2)];
  const scaredSpr1 = engine.sprite("..oooooo..\n.occcccco.\noccwccwcco\nocccccccco\noc.wc.wcco\nocw.ww.wco\noc.occo.co\no..o..o..o", { o: 16, c: 12, w: 7 });
  const scaredSpr2 = engine.sprite("..oooooo..\n.owwwwwwo.\nowwrwwrwwo\nowwwwwwwwo\now.rw.rwwo\nowr.rr.rwo\n.wo.oo.ow.\n..o....o..", { o: 16, w: 7, r: 8 });
  const gemSpr = engine.sprite("...oooo...\n..ocwwco..\n.ocwwwwco.\nocwccccaco\n.ocaaacco.\n..occcco..\n...oooo...", { o: 16, c: P.accent2, a: P.accent1, w: 7 });

  const LAYOUTS = [
    [
      "###################", "#o.......#.......o#", "#.##.###.#.###.##.#", "#.................#",
      "#.##.#.#####.#.##.#", ".....#...G...#.....", "####.###.#.###.####", "#.................#",
      "#.##.###.#.###.##.#", "#o.......S.......o#", "###################",
    ],
    [
      "###################", "#o...#.......#...o#", "#.##.#.#####.#.##.#", "#....#...#...#....#",
      "###.####.#.####.###", ".....#...G...#.....", "###.####.#.####.###", "#....#.......#....#",
      "#.##.#.#####.#.##.#", "#o.......S.......o#", "###################",
    ],
  ];

  const COLS = 19, ROWS = 11, TS = 14, OX = 27, OY = 24;
  let stage = 1, layout = LAYOUTS[0], dots = [], totalDots = 0, maxDots = 0;
  let bonusActive = false, bonusSpawned = false, frightCombo = 0, sparks = [], popups = [];

  function burst(x, y, col, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + engine.rng() * 0.5;
      sparks.push({ x, y, vx: Math.cos(a) * 55, vy: Math.sin(a) * 55, life: 0.3, col });
    }
  }
  const addPopup = (txt, x, y, col = 7) => popups.push({ txt, x, y, col, life: 0.65 });

  function buildDots() {
    layout = LAYOUTS[(stage - 1) % LAYOUTS.length];
    dots = []; totalDots = 0; bonusActive = false; bonusSpawned = false;
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const ch = layout[r][c];
        const v = ch === "." ? 1 : ch === "o" ? 2 : 0;
        if (v > 0) totalDots++;
        row.push(v);
      }
      dots.push(row);
    }
    maxDots = totalDots;
  }
  buildDots();

  const isWall = (c, r) => {
    if (r < 0 || r >= ROWS) return true;
    if (r === 5 && (c < 0 || c >= COLS)) return false;
    return c < 0 || c >= COLS || layout[r][c] === "#";
  };
  const tileCenter = (c, r) => ({ x: OX + c * TS + TS / 2, y: OY + r * TS + TS / 2 });

  const startPos = tileCenter(9, 9), gemPos = tileCenter(9, 5);
  let hx = startPos.x, hy = startPos.y, dirX = 1, dirY = 0;
  let lives = 3, inv = 0, fright = 0, dashTimer = 0, dashCd = 0;

  function makeGhosts() {
    const g0 = tileCenter(1, 1), g1 = tileCenter(17, 1), g2 = tileCenter(8, 1);
    return [
      { x: g0.x, y: g0.y, vx: 1, vy: 0, homeC: 1, homeR: 1, role: 0, active: true },
      { x: g1.x, y: g1.y, vx: -1, vy: 0, homeC: 17, homeR: 1, role: 1, active: true },
      { x: g2.x, y: g2.y, vx: 1, vy: 0, homeC: 8, homeR: 1, role: 2, active: stage > 1 || engine.time > 8 },
    ];
  }
  let ghosts = makeGhosts();
  engine.lives(lives);

  const canMove = (px, py, dx, dy) =>
    !isWall(Math.floor((px + dx * 5 - OX) / TS), Math.floor((py + dy * 5 - OY) / TS));

  return {
    update(dt, input) {
      if (inv > 0) inv -= dt;
      if (fright > 0) fright -= dt;
      if (dashTimer > 0) dashTimer -= dt;
      if (dashCd > 0) dashCd -= dt;

      if ((input.pressed.a || input.pressed.b) && dashCd <= 0) {
        dashTimer = 0.22; dashCd = 1.8; engine.sfx("jump"); burst(hx, hy, P.accent2, 6);
      }

      let wantX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let wantY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if ((input.a || dashTimer > 0) && wantX === 0 && wantY === 0) { wantX = dirX; wantY = dirY; }

      const spd = (dashTimer > 0 ? 132 : 76) * dt;
      const curC = Math.max(0, Math.min(COLS - 1, Math.floor((hx - OX) / TS)));
      const curR = Math.max(0, Math.min(ROWS - 1, Math.floor((hy - OY) / TS)));
      const center = tileCenter(curC, curR);

      if (wantX !== 0 && !isWall(curC + wantX, curR) && Math.abs(hy - center.y) < 6) {
        hy += (center.y - hy) * 0.45; dirX = wantX; dirY = 0;
      } else if (wantY !== 0 && !isWall(curC, curR + wantY) && Math.abs(hx - center.x) < 6) {
        hx += (center.x - hx) * 0.45; dirX = 0; dirY = wantY;
      }

      if (wantX !== 0 || wantY !== 0 || input.a || dashTimer > 0) {
        if (canMove(hx + dirX * spd, hy + dirY * spd, dirX, dirY)) {
          hx += dirX * spd; hy += dirY * spd;
          if (dashTimer > 0 && engine.frame % 2 === 0) {
            sparks.push({ x: hx, y: hy, vx: -dirX * 20, vy: -dirY * 20, life: 0.18, col: 7 });
          }
        } else {
          hx += (center.x - hx) * 0.3; hy += (center.y - hy) * 0.3;
        }
      }
      if (hx < OX + 2) hx = OX + COLS * TS - 3;
      else if (hx > OX + COLS * TS - 2) hx = OX + 3;

      const hc = Math.floor((hx - OX) / TS), hr = Math.floor((hy - OY) / TS);
      if (hr >= 0 && hr < ROWS && hc >= 0 && hc < COLS && dots[hr][hc] > 0) {
        const kind = dots[hr][hc];
        dots[hr][hc] = 0; totalDots--;
        if (!bonusSpawned && totalDots <= (maxDots >> 1)) { bonusActive = true; bonusSpawned = true; }
        if (kind === 2) {
          fright = 6.0; frightCombo = 0; engine.score(25); engine.sfx("powerup"); burst(hx, hy, P.accent1, 8);
        } else {
          engine.score(10); engine.sfx("coin");
        }
        if (totalDots <= 0) {
          stage++; engine.score(100); engine.sfx("win"); addPopup("STAGE " + stage, 160, 96, P.accent2);
          buildDots(); hx = startPos.x; hy = startPos.y; dirX = 1; dirY = 0; ghosts = makeGhosts();
        }
      }
      if (bonusActive && Math.hypot(hx - gemPos.x, hy - gemPos.y) < 10) {
        bonusActive = false; engine.score(75); engine.sfx("powerup");
        burst(gemPos.x, gemPos.y, P.accent2, 10); addPopup("+75", gemPos.x, gemPos.y - 6, P.accent2);
      }

      if (engine.time > 8) ghosts[2].active = true;
      const gSpd = (fright > 0 ? 42 : 62 + Math.min(25, engine.time * 0.5)) * dt;
      for (const gh of ghosts) {
        if (!gh.active) continue;
        const gc = Math.max(0, Math.min(COLS - 1, Math.floor((gh.x - OX) / TS)));
        const gr = Math.max(0, Math.min(ROWS - 1, Math.floor((gh.y - OY) / TS)));
        const tileId = gr * COLS + gc, gCen = tileCenter(gc, gr);
        const blocked = isWall(gc + gh.vx, gr + gh.vy), distCen = Math.hypot(gh.x - gCen.x, gh.y - gCen.y);
        const passedCen = (gh.x - gCen.x) * gh.vx + (gh.y - gCen.y) * gh.vy >= 0;
        if (gh.lastTile !== tileId && (distCen < 2.4 || (blocked && passedCen))) {
          gh.lastTile = tileId;
          const dirs = [{ vx: 1, vy: 0 }, { vx: -1, vy: 0 }, { vx: 0, vy: 1 }, { vx: 0, vy: -1 }]
            .filter((d) => !isWall(gc + d.vx, gr + d.vy));
          const nonRev = dirs.filter((d) => !(d.vx === -gh.vx && d.vy === -gh.vy));
          const pool = nonRev.length > 0 ? nonRev : dirs;
          if (pool.length > 0) {
            const distHero = Math.hypot(gh.x - hx, gh.y - hy);
            const tx = gh.role === 1 && distHero > 42 ? hx + dirX * TS * 3 : gh.role === 2 && ((engine.time | 0) % 6 < 2) ? 160 : hx;
            const ty = gh.role === 1 && distHero > 42 ? hy + dirY * TS * 3 : gh.role === 2 && ((engine.time | 0) % 6 < 2) ? 60 : hy;
            pool.sort((a, b) => {
              const da = Math.hypot(OX + (gc + a.vx) * TS - tx, OY + (gr + a.vy) * TS - ty);
              const db = Math.hypot(OX + (gc + b.vx) * TS - tx, OY + (gr + b.vy) * TS - ty);
              return fright > 0 ? db - da : da - db;
            });
            const pick = engine.rng() < 0.82 ? pool[0] : pool[engine.rngInt(0, pool.length - 1)];
            gh.vx = pick.vx; gh.vy = pick.vy; gh.x = gCen.x; gh.y = gCen.y;
          }
        }
        gh.x += gh.vx * gSpd; gh.y += gh.vy * gSpd;
        if (gh.x < OX + 2) gh.x = OX + COLS * TS - 3;
        else if (gh.x > OX + COLS * TS - 2) gh.x = OX + 3;

        if (Math.hypot(gh.x - hx, gh.y - hy) < 9) {
          if (fright > 0) {
            frightCombo = Math.min(3, frightCombo + 1);
            const pts = frightCombo * 50;
            engine.score(pts); engine.sfx("explode");
            burst(gh.x, gh.y, 12, 10); addPopup("+" + pts, gh.x, gh.y - 6, 7);
            const home = tileCenter(gh.homeC, gh.homeR);
            gh.x = home.x; gh.y = home.y; gh.lastTile = -1;
          } else if (inv <= 0) {
            lives--; inv = 1.8; engine.lives(lives); engine.sfx("hit"); engine.shake(8, 2);
            burst(hx, hy, 8, 10); ghosts = makeGhosts();
            if (lives <= 0) engine.gameOver(heroName + " CAUGHT");
            break;
          }
        }
      }
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
      sparks = sparks.filter((s) => s.life > 0);
      for (const p of popups) { p.y -= 18 * dt; p.life -= dt; }
      popups = popups.filter((p) => p.life > 0);
    },

    draw(g) {
      g.dither(0, 0, 320, 200, 17, P.bg, 1);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const tx = OX + c * TS, ty = OY + r * TS;
          if (layout[r][c] === "#") {
            g.rect(tx, ty, TS, TS, 16);
            g.rect(tx + 1, ty + 1, TS - 2, TS - 2, P.fg);
            g.rect(tx + 2, ty + 2, TS - 4, 2, P.accent1);
          } else if (dots[r][c] === 1) {
            g.rect(tx + 5, ty + 5, 3, 3, P.accent2);
            g.pset(tx + 5, ty + 5, 7);
          } else if (dots[r][c] === 2 && engine.frame % 16 < 12) {
            g.circ(tx + 7, ty + 7, 4, P.accent1);
            g.circ(tx + 7, ty + 7, 2, 7);
          }
        }
      }
      if (bonusActive) g.spr(gemSpr, gemPos.x - 5, gemPos.y - 4 + ((engine.frame >> 3) & 1));
      const hSpr = (engine.frame >> 2) & 1 ? hero2 : hero1;
      if (inv <= 0 || engine.frame % 6 < 3) g.spr(hSpr, hx - 6, hy - 5, { flipX: dirX < 0 });
      for (const gh of ghosts) {
        if (!gh.active) continue;
        const anim = (engine.frame >> 3) & 1;
        const spr = fright > 0 ? (fright < 1.8 && (engine.frame >> 2) & 1 ? scaredSpr2 : scaredSpr1) : ghostSets[gh.role][anim];
        g.spr(spr, gh.x - 5, gh.y - 4);
        if (fright <= 0) {
          g.pset(gh.x - 2 + gh.vx, gh.y - 1 + gh.vy, 16);
          g.pset(gh.x + 1 + gh.vx, gh.y - 1 + gh.vy, 16);
        }
      }
      for (const s of sparks) g.rect(s.x, s.y, 2, 2, s.col);
      for (const p of popups) g.text(p.txt, p.x, p.y, p.col, { align: "center" });
      engine.hud(g);
    },
  };
}
