// Procedural "what it might look like" sunset illustration, rendered for ANY moment (golden hour → twilight).
// Physically-motivated, not a photo: sky color follows sun elevation; each cloud layer stays sunlit until the
// sun drops below its own "local horizon" (depression ≈ sqrt(2h/R)), so low cloud goes dark first, cirrus last.
(function (g) {
  function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t)));
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  // piecewise color ramp over x (stops sorted DESC by x)
  const ramp = (x, stops) => {
    if (x >= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (x >= stops[i][0]) { const [x0, c0] = stops[i - 1], [x1, c1] = stops[i]; return mix(c1, c0, (x - x1) / (x0 - x1)); }
    return stops[stops.length - 1][1];
  };
  const DEPRESS = { high: Math.sqrt(2 * 9 / 6371) * 57.3 + 0.5, mid: Math.sqrt(2 * 4 / 6371) * 57.3 + 0.5, low: Math.sqrt(2 * 1 / 6371) * 57.3 + 0.3 };

  // Sky gradient by sun elevation (top, mid, horizon)
  const SKY_TOP = [[8, [58, 104, 176]], [3, [48, 80, 150]], [0, [42, 52, 112]], [-2, [32, 32, 88]], [-4, [20, 20, 60]], [-7, [9, 11, 32]]];
  const SKY_MID = [[8, [128, 166, 208]], [3, [170, 156, 182]], [0, [206, 122, 142]], [-2, [178, 82, 130]], [-4, [92, 52, 112]], [-7, [28, 24, 60]]];
  const SKY_HOR = [[8, [236, 222, 196]], [3, [255, 204, 126]], [0, [255, 152, 72]], [-2, [255, 112, 62]], [-4, [212, 92, 62]], [-7, [80, 46, 58]]];
  // Color of direct sunlight reaching a cloud, by the sun's elevation above that cloud's local horizon
  const LIGHT = [[9, [255, 246, 228]], [5, [255, 222, 160]], [2.5, [255, 170, 86]], [1, [255, 112, 72]], [0.2, [244, 84, 120]], [-0.6, [190, 70, 130]]];
  // Shadowed cloud base color, by sun elevation (ambient sky light)
  const SHADE = [[6, [172, 172, 188]], [2, [128, 120, 142]], [0, [96, 86, 116]], [-3, [58, 54, 86]], [-6, [26, 26, 48]]];
  const DULL = [[6, [150, 156, 170]], [0, [118, 116, 128]], [-3, [62, 62, 80]], [-7, [18, 18, 30]]];

  function blob(ctx, x, y, rx, ry, c, a) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); gr.addColorStop(0, rgba(c, a)); gr.addColorStop(0.55, rgba(c, a * 0.85)); gr.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.283); ctx.fill(); ctx.restore();
  }
  function phaseOf(elev, dom) {
    const dep = DEPRESS[dom] || 2;
    if (elev > 6.3) return "Daylight";
    if (elev > -0.3) return "Golden hour";
    if (elev > -1.4) return "Sunset";
    if (elev > -dep - 0.3) return "Afterglow";
    if (elev > -6.3) return "Blue hour";
    return "Night";
  }

  // Stable cloud geometry for a spot/day so the scene doesn't jump while you drag the time slider
  function geometry(W, H, spot, ev) {
    const key = spot.id + ev.tSet + W + "x" + H;
    const r = rng(spot.id + ev.tSet), s = ev.s, hz = H * 0.66;
    const hi = (s.high || 0) / 100, md = (s.mid || 0) / 100, lo = (s.low || 0) / 100, blk = ev.slotBlock;
    const G = { key, veil: [], cirrus: [], mid: [], low: [], bank: [], stars: [], rain: [], ripples: [] };
    for (let i = 0; i < 14; i++) G.veil.push({ x: r() * W, y: H * (0.04 + r() * 0.38), rx: W * (0.25 + r() * 0.35), ry: H * (0.02 + r() * 0.03), a: 0.35 + r() * 0.5 });
    const nHi = Math.round(hi * 44);
    for (let i = 0; i < nHi; i++) {
      const y = H * (0.03 + Math.pow(r(), 1.3) * 0.42), len = W * (0.18 + r() * 0.4) * (1 - y / H * 0.6);
      G.cirrus.push({ x: r() * W * 1.1 - W * 0.1, y, len, bend: (r() - 0.5) * H * 0.08, w: (1.5 + r() * 4) * H / 300, a: 0.25 + r() * 0.4, hairs: Array.from({ length: 5 }, () => [r(), (r() - 0.5) * 14 * H / 300, r()]) });
    }
    // altocumulus: perspective rows (big puffs overhead → small near horizon)
    if (md > 0.04) {
      const rows = 5 + Math.round(md * 7);
      for (let k = 0; k < rows; k++) {
        const f = k / rows, y = H * (0.12 + f * 0.4) + (r() - 0.5) * 8, sc = (1 - f * 0.65) * H / 300, rad = (11 + r() * 5) * sc;
        let x = -rad * 2 + r() * rad * 2;
        while (x < W + rad * 2) {
          if (r() < 0.25 + md * 0.75) G.mid.push({ x, y: y + (r() - 0.5) * rad * 0.8, rx: rad * (1.4 + r() * 0.9), ry: rad * (0.55 + r() * 0.3), a: 0.55 + r() * 0.35 });
          x += rad * (1.9 + r() * 1.4) / Math.max(0.5, md + 0.25);
        }
      }
    }
    const nLo = Math.round(lo * 30);
    for (let i = 0; i < nLo; i++) { const sc = H / 300; G.low.push({ x: r() * W, y: hz - H * (0.03 + r() * 0.18 * (0.4 + lo)), rx: (34 + r() * 60) * sc, ry: (9 + r() * 12) * sc, a: 0.7 + r() * 0.25 }); }
    // western low-cloud bank along the sunset line (what blocks the light)
    if (blk > 0.18) {
      const span = W * (0.35 + blk * 0.9), thick = H * (0.025 + blk * 0.13);
      for (let x = W / 2 - span / 2; x < W / 2 + span / 2; x += (8 + r() * 14) * H / 300) {
        if (r() < 0.25 * (1 - blk)) continue;   // gaps in a broken bank
        const ry = thick * (0.25 + r() * 0.65); G.bank.push({ x, y: hz - ry * 0.5 - r() * thick * 0.35, rx: (10 + r() * 22) * H / 300, ry, a: 0.75 + r() * 0.2, soft: 1 });
      }
    }
    for (let i = 0; i < 70; i++) G.stars.push({ x: r() * W, y: r() * H * 0.4, s: r() * 1.4 + 0.3, a: r() });
    for (let i = 0; i < 80; i++) G.rain.push({ x: r() * W, y: H * (0.25 + r() * 0.3) });
    for (let i = 0; i < 46; i++) G.ripples.push({ y: r(), w: r(), j: r() - 0.5 });
    // water-surface texture: wavelets (troughs/crests), whitecaps and reflection-strip jitter — fixed per spot/day, moved by time
    G.waves = Array.from({ length: 220 }, () => ({ y: r(), x: r(), w: r(), k: r(), s: r() }));
    G.caps = Array.from({ length: 170 }, () => ({ y: r(), x: r(), w: r(), k: r(), s: r() }));
    return G;
  }

  function draw(canvas, spot, ev, t) {
    const { sunPos } = window.Model;
    if (t == null) t = ev.timing.peak;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 340;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!canvas._g || canvas._g.key !== spot.id + ev.tSet + W + "x" + H) canvas._g = geometry(W, H, spot, ev);
    const G = canvas._g, s = ev.s;
    const elev = sunPos(t, spot.lat, spot.lng).elev;
    const hi = (s.high || 0) / 100, md = (s.mid || 0) / 100, lo = (s.low || 0) / 100, blk = ev.slotBlock;
    const haze = clamp(Math.max(0, (0.85 - ev.clean) * 0.9) + (ev.rhLow > 85 ? 0.1 : 0), 0, 0.5);
    const lightIn = clamp(1 - blk * 1.05);          // how much sunlight gets under the western cloud
    const skyVivid = clamp(ev.clean * (1 - 0.75 * Math.max(lo, blk)) * (1 - 0.5 * Math.max(0, hi + md - 1.3)));
    const app = elev + 0.83; // refraction + semi-diameter: official sunset = upper limb touching horizon
    const hz = H * 0.66, pxDeg = H * 0.05, sunX = W * 0.5, sunY = hz - app * pxDeg, sunR = H * 0.032;
    const dull = ramp(elev, DULL);

    // 1) sky
    const top = mix(dull, ramp(elev, SKY_TOP), skyVivid), mid = mix(dull, ramp(elev, SKY_MID), skyVivid), hor = mix(mix(dull, ramp(elev, SKY_HOR), skyVivid), [222, 204, 192], haze * 0.6);
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, rgba(top)); sky.addColorStop(0.58, rgba(mid)); sky.addColorStop(1, rgba(hor));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz + 1);
    // stars as twilight deepens
    if (elev < -3.5) { const a = clamp((-3.5 - elev) / 3) * (1 - hi * 0.8) * (1 - haze); for (const st of G.stars) { ctx.fillStyle = `rgba(255,250,240,${a * st.a})`; ctx.fillRect(st.x, st.y, st.s, st.s); } }
    // sun glow (sits above the sunset point even after the sun is down)
    const glowA = clamp((elev + 6) / 8) * (0.35 + 0.65 * lightIn);
    if (glowA > 0) {
      const gc = ramp(elev, LIGHT), gy = Math.max(sunY, hz - 2);
      const glow = ctx.createRadialGradient(sunX, gy, 1, sunX, gy, W * (0.25 + 0.35 * clamp((elev + 4) / 8)));
      glow.addColorStop(0, rgba(mix(gc, [255, 245, 215], clamp(elev / 4)), 0.85 * glowA)); glow.addColorStop(0.25, rgba(gc, 0.4 * glowA)); glow.addColorStop(1, rgba(gc, 0));
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, hz);
    }

    // cloud shading: lit color for a layer given its depression allowance
    const near = x => 0.55 + 0.45 * Math.exp(-(((x - sunX) / (W * 0.38)) ** 2)); // forward scattering near the sun
    const shade = mix(dull, ramp(elev, SHADE), skyVivid * 0.6 + 0.4);
    const layerLight = dom => { const e = elev + DEPRESS[dom]; const lit = clamp((e + 0.6) / 1.2) * lightIn; return { c: ramp(e, LIGHT), lit }; };
    const L = { high: layerLight("high"), mid: layerLight("mid"), low: layerLight("low") };

    // 2) high cloud: cirrostratus veil + cirrus streaks
    if (hi > 0.35) {
      const c = mix(shade, L.high.c, L.high.lit * 0.9), va = clamp((hi - 0.35) * 1.15, 0, 0.72);
      const v = ctx.createLinearGradient(0, 0, 0, hz * 0.85); v.addColorStop(0, rgba(c, va)); v.addColorStop(0.7, rgba(c, va * 0.55)); v.addColorStop(1, rgba(c, 0)); ctx.fillStyle = v; ctx.fillRect(0, 0, W, hz);
      for (const b of G.veil) {   // very soft streaks in the ice sheet
        ctx.save(); ctx.translate(b.x, b.y); ctx.scale(1, b.ry / b.rx);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, b.rx), cc = mix(c, [255, 255, 255], 0.1 * L.high.lit);
        gr.addColorStop(0, rgba(cc, va * b.a * 0.45)); gr.addColorStop(1, rgba(cc, 0)); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, b.rx, 0, 6.283); ctx.fill(); ctx.restore();
      }
    }
    ctx.lineCap = "round";
    for (const c of G.cirrus) {
      const col = mix(shade, L.high.c, L.high.lit * near(c.x + c.len / 2));
      for (let h = -1; h < c.hairs.length; h++) {
        const [o, dy, f] = h < 0 ? [0, 0, 1] : c.hairs[h];
        ctx.strokeStyle = rgba(col, c.a * (h < 0 ? 1 : 0.45)); ctx.lineWidth = h < 0 ? c.w : c.w * 0.4;
        const x0 = c.x + o * c.len * 0.3, y0 = c.y + dy, l = c.len * (h < 0 ? 1 : 0.4 + f * 0.5);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x0 + l * 0.3, y0 + c.bend, x0 + l * 0.65, y0 - c.bend * 0.6, x0 + l, y0 + c.bend * 0.3 + (h < 0 ? 0 : 6)); ctx.stroke();
      }
    }
    // 3) mid altocumulus: dark-ish tops, glowing undersides (sun is below them)
    for (const p of G.mid) {
      const lt = L.mid.lit * near(p.x), base = mix(shade, L.mid.c, lt * 0.45);
      blob(ctx, p.x, p.y, p.rx * 1.15, p.ry * 1.2, base, p.a);
      blob(ctx, p.x - p.rx * 0.45, p.y + p.ry * 0.1, p.rx * 0.6, p.ry * 0.9, base, p.a * 0.8);
      if (lt > 0.05) blob(ctx, p.x, p.y + p.ry * 0.38, p.rx * 0.95, p.ry * 0.6, mix(L.mid.c, [255, 255, 255], clamp(elev / 12)), Math.min(1, p.a * lt * 1.1));
    }
    if (md > 0.85) { ctx.fillStyle = rgba(mix(shade, L.mid.c, L.mid.lit * 0.5), 0.45); ctx.fillRect(0, H * 0.1, W, H * 0.42); }

    // 4) sun disk (flattened + reddened near horizon)
    if (app > -1.2) {
      const sc = ramp(app, [[6, [255, 246, 214]], [2, [255, 214, 140]], [0, [255, 140, 70]], [-1, [240, 90, 60]]]);
      const vis = (1 - haze * 0.7) * (0.25 + 0.75 * lightIn);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
      const hal = ctx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 4); hal.addColorStop(0, rgba(sc, 0.6 * vis)); hal.addColorStop(1, rgba(sc, 0)); ctx.fillStyle = hal; ctx.fillRect(sunX - sunR * 4, sunY - sunR * 4, sunR * 8, sunR * 8);
      ctx.fillStyle = rgba(sc, vis); ctx.beginPath(); ctx.ellipse(sunX, sunY, sunR, sunR * (app < 2 ? 0.82 + Math.max(0, app) * 0.09 : 1), 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    // sun dogs (22° either side, need sun low and visible through ice cloud)
    if (ev.dog.p >= 20 && elev > 0.3 && elev < 12) {
      const off = 22 * pxDeg * 1.05, a = Math.min(0.9, ev.dog.p / 55) * lightIn * clamp((elev - 0.3) / 1.5);
      for (const sx of [sunX - off, sunX + off]) {
        const gd = ctx.createRadialGradient(sx, sunY, 1, sx, sunY, sunR * 1.6);
        gd.addColorStop(0, `rgba(255,250,232,${a})`); gd.addColorStop(0.45, `rgba(255,170,110,${a * 0.5})`); gd.addColorStop(1, "rgba(120,160,255,0)");
        ctx.fillStyle = gd; ctx.fillRect(sx - sunR * 2, sunY - sunR * 2, sunR * 4, sunR * 4);
      }
      ctx.strokeStyle = `rgba(255,240,220,${a * 0.22})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sunX, sunY, off, Math.PI * 1.04, Math.PI * 1.96); ctx.stroke();
    }
    // crepuscular rays through gaps in the western bank
    const rays = ev.badges.find(b => b.id === "rays");
    if (rays && rays.p >= 25 && elev > -3 && elev < 4) {
      const a = (rays.p / 100) * clamp(1 - Math.abs(elev) / 4) * 0.12;
      ctx.save(); ctx.globalCompositeOperation = "lighter"; const ry = rng(spot.id + "rays");
      for (let i = 0; i < 11; i++) { const ang = Math.PI * (1.1 + i * 0.075 + ry() * 0.03); ctx.fillStyle = `rgba(255,200,150,${a * (0.5 + ry())})`; ctx.beginPath(); ctx.moveTo(sunX, Math.max(sunY, hz - 4)); ctx.lineTo(sunX + Math.cos(ang) * W, hz + Math.sin(ang) * W); ctx.lineTo(sunX + Math.cos(ang + 0.03) * W, hz + Math.sin(ang + 0.03) * W); ctx.fill(); }
      ctx.restore();
    }
    // 5) low cloud: dark undersides with bright rims while the sun can still reach them
    const lowCol = mix(mix(shade, [40, 38, 58], 0.45), L.low.c, L.low.lit * 0.25);
    for (const p of [...G.bank, ...G.low]) {
      if (p.soft) blob(ctx, p.x, p.y, p.rx * 1.3, p.ry * 1.3, lowCol, p.a);
      else { ctx.fillStyle = rgba(lowCol, p.a || 0.92); ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, 6.283); ctx.fill(); }
      const rim = L.low.lit * near(p.x);
      if (rim > 0.08) { ctx.strokeStyle = rgba(L.low.c, 0.7 * rim); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); }
    }
    // weather during the event window (from the forecast): rain slanted by wind, storm cell + lightning, whitecaps
    const WX = ev.wx || { items: [], bolt: { p: 0 }, wind: { mph: s.wind || 0 } };
    const wxOn = id => WX.items.some(x => x.id === id);
    const windMph = Math.max(WX.wind.mph || 0, s.wind || 0), slant = -6 - clamp(windMph / 30) * 34;
    const boltP = WX.bolt.p || 0, bw = WX.bolt.win, boltNear = boltP >= 25 && (!bw || (t >= bw.start - 1800 && t <= bw.end + 1800));
    if (boltNear) {   // dark storm cell on the side away from the sun's glow
      const cx = W * 0.14, top = H * 0.08, cell = mix(shade, [34, 32, 52], 0.6);
      blob(ctx, cx, hz - H * 0.22, W * 0.2, H * 0.2, cell, 0.95); blob(ctx, cx + W * 0.08, top + H * 0.07, W * 0.24, H * 0.06, cell, 0.85); blob(ctx, cx - W * 0.04, hz - H * 0.36, W * 0.13, H * 0.13, cell, 0.9);
      ctx.strokeStyle = rgba(cell, 0.35); ctx.lineWidth = 1.2; for (let i = 0; i < 26; i++) { const x = cx - W * 0.14 + i * W * 0.011; ctx.beginPath(); ctx.moveTo(x, hz - H * 0.1); ctx.lineTo(x + slant * 0.6, hz); ctx.stroke(); }
    }
    // rain / snow falls as the slider or Play moves (offset by forecast time); drawn ONLY when the forecast has it
    const fall = ((t / 30) % 1 + 1) % 1;
    if (wxOn("snow")) {
      ctx.fillStyle = "rgba(240,244,255,0.75)";
      for (const p of G.rain) { const yy = H * 0.05 + ((p.y / H + fall * 0.6) % 1) * (H - H * 0.05), xx = p.x + slant * 0.4 * ((yy / H + fall) % 1); ctx.beginPath(); ctx.arc(xx, yy, 1.1 + (p.x % 3) * 0.5, 0, 6.283); ctx.fill(); }
    } else if ((s.precip || 0) > 0.1 || (s.pprob || 0) > 50 || wxOn("rain")) { ctx.strokeStyle = rgba(mix(shade, [200, 200, 220], 0.4), wxOn("rain") ? 0.3 : 0.2); ctx.lineWidth = 1; const dy = fall * H * 0.25; for (const p of G.rain) { const y0 = p.y - H * 0.12 + dy; ctx.beginPath(); ctx.moveTo(p.x - slant * fall, y0); ctx.lineTo(p.x - slant * fall + slant, y0 + H * 0.25); ctx.stroke(); } }
    if (boltNear) {   // lightning: flickers as the time slider / Play moves (deterministic per minute)
      const m = Math.floor(t / 60), hsh = ((m * 2654435761) >>> 0) % 7, strong = boltP >= 40 ? hsh !== 3 : hsh % 3 === 0;
      if (strong) {
        const rb = rng(spot.id + "bolt" + (m % 5)); let x = W * (0.1 + rb() * 0.1), y = hz - H * 0.3; const pts = [[x, y]];
        while (y < hz - 2) { y += H * (0.03 + rb() * 0.04); x += (rb() - 0.5) * W * 0.04; pts.push([x, Math.min(y, hz - 2)]); }
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const fl = ctx.createRadialGradient(pts[0][0], pts[0][1], 2, pts[0][0], pts[0][1], W * 0.3); fl.addColorStop(0, "rgba(200,190,255,0.35)"); fl.addColorStop(1, "rgba(200,190,255,0)"); ctx.fillStyle = fl; ctx.fillRect(0, 0, W, hz);
        for (const [lw, a] of [[6, 0.15], [3, 0.35], [1.4, 0.95]]) { ctx.strokeStyle = `rgba(235,230,255,${a})`; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke(); }
        ctx.restore();
      }
    }
    // haze veil at the horizon
    if (haze > 0.02) { const hzG = ctx.createLinearGradient(0, hz - H * 0.3, 0, hz); hzG.addColorStop(0, "rgba(220,200,190,0)"); hzG.addColorStop(1, rgba(mix([220, 200, 190], hor, 0.5), haze)); ctx.fillStyle = hzG; ctx.fillRect(0, 0, W, hz); }

    // 6) ground: water mirrors the sky, land is a silhouette.
    // WATER SURFACE follows the forecast wind / gusts (+ wave height) at this exact time: glassy → mirror reflection;
    // breezy → wavelets break the reflection into strips and widen the sun's glitter path; windy → whitecaps.
    const SEA = spot.water !== false ? ((window.Model.seaAt && window.Model.seaAt(ev, t)) || (window.Model.seaState ? window.Model.seaState({ wind: s.wind || 0, gust: s.gust || 0 }, 0.5) : null)) : null;
    const wb = ctx.createLinearGradient(0, hz, 0, H); wb.addColorStop(0, rgba(mix(hor, [16, 14, 34], 0.5))); wb.addColorStop(1, "rgb(8,8,20)");
    ctx.fillStyle = wb; ctx.fillRect(0, hz, W, H - hz);
    if (spot.water !== false) {
      const chop = SEA ? SEA.chop : clamp(windMph / 25), swell = SEA ? SEA.swell : 0, caps = SEA ? SEA.caps : clamp((windMph - 10) / 18), mirror = SEA ? SEA.mirror : clamp(1 - windMph / 8);
      const ph = t / 420;   // wave motion: advances with the slider / Play
      const WH = H - hz, rh = Math.min(hz, WH * 1.6), reflA = 0.4 + 0.42 * mirror - 0.12 * chop;
      if (chop < 0.1) {   // slick: one clean mirror image of the sky
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = reflA;
        ctx.translate(0, 2 * hz * dpr); ctx.scale(1, -1);
        ctx.drawImage(canvas, 0, (hz - rh) * dpr, W * dpr, rh * dpr, 0, (hz - rh) * dpr, W * dpr, rh * dpr);
        ctx.restore();
      } else {            // rippled: the reflection breaks into horizontal strips that wobble sideways and smear vertically
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        const rr = rng(spot.id + "refl");
        for (let y = hz; y < H; ) {
          const d = (y - hz) / WH, sh = Math.max(1, (1 + chop * 5) * (0.35 + d * 2.2));
          const src = 2 * hz - y - sh * (1 + chop * 2.5 * rr()), dx = Math.sin(y * 0.9 + ph * 6.283 + rr() * 6) * chop * (2 + 26 * d) + (rr() - 0.5) * chop * 10 * d;
          if (src > hz - rh && src > 0) {
            ctx.globalAlpha = clamp(reflA * (1 - 0.35 * chop * rr()));
            ctx.drawImage(canvas, 0, src * dpr, W * dpr, Math.max(1, sh * (1 + chop)) * dpr, dx * dpr, y * dpr, W * dpr, sh * dpr);
          }
          y += sh;
        }
        ctx.restore();
      }
      const dk = ctx.createLinearGradient(0, hz, 0, H); dk.addColorStop(0, `rgba(8,8,22,${0.03 + 0.06 * chop})`); dk.addColorStop(1, `rgba(8,8,22,${0.32 + 0.25 * (1 - mirror)})`); ctx.fillStyle = dk; ctx.fillRect(0, hz, W, H - hz);
      // swell: broad lit / shadowed bands rolling toward the shore (from wave height; wind sea if no marine data)
      if (swell > 0.04) {
        const nb = 9;
        for (let k = 0; k < nb; k++) {
          const f = ((k + ph * 0.6) % nb) / nb, d = f * f, yy = hz + 1 + d * WH, bh = (2 + 30 * d) * (0.4 + swell);
          const gB = ctx.createLinearGradient(0, yy - bh, 0, yy + bh);
          gB.addColorStop(0, rgba(hor, 0)); gB.addColorStop(0.45, rgba(mix(hor, [255, 255, 255], 0.1), 0.1 * swell * (0.3 + d))); gB.addColorStop(0.55, `rgba(0,0,12,${0.22 * swell * (0.3 + d)})`); gB.addColorStop(1, "rgba(0,0,12,0)");
          ctx.fillStyle = gB; ctx.fillRect(0, yy - bh, W, bh * 2);
        }
      }
      // sun glitter path: a tight mirror column when glassy, a wide broken sparkle field when choppy
      const gl = clamp((elev + 1.5) / 4) * lightIn * (1 - haze), lc = ramp(elev, LIGHT);
      if (gl > 0.01 && mirror > 0.05) {   // still-water sun reflection
        const cw = sunR * (1.2 + 2 * (1 - mirror)), cg = ctx.createLinearGradient(0, hz, 0, H);
        cg.addColorStop(0, rgba(mix(lc, [255, 250, 230], 0.4), gl * mirror * 0.9)); cg.addColorStop(0.5, rgba(lc, gl * mirror * 0.35)); cg.addColorStop(1, rgba(lc, 0));
        ctx.fillStyle = cg; ctx.fillRect(sunX - cw, hz, cw * 2, WH);
      }
      const spread = 0.35 + 2.6 * chop;
      for (const rp of G.ripples) {
        if (rp.w < chop * 0.35 && chop > 0.5) continue;   // broken path when rough
        const yy = hz + 2 + rp.y * WH, d = (yy - hz) / WH, w = (20 + rp.w * 50) * (0.4 + d * 2) * H / 300 * spread;
        ctx.fillStyle = rgba(lc, gl * (0.25 + 0.5 * (1 - mirror)) * (1 - d * 0.6)); ctx.fillRect(sunX - w / 2 + rp.j * (10 + 60 * chop) * d + Math.sin(ph * 6.283 + rp.y * 40) * chop * 6, yy, w, 1 + chop * 1.4);
      }
      // wavelets: dark troughs + sky-lit crests; count, length and contrast scale with chop
      const nW = Math.round(G.waves.length * clamp(0.04 + chop * 1.05));
      for (let i = 0; i < nW; i++) {
        const wv = G.waves[i], d = Math.pow(wv.y, 1.7), yy = hz + 2 + d * (WH - 3);
        const len = (6 + wv.w * 30) * (0.3 + d * 2.4) * H / 300 * (1.4 - 0.6 * chop), th = (0.5 + d * 2.4) * (0.35 + chop);
        const x = ((wv.x * W + (ph * (8 + 30 * wv.s) * (0.3 + d)) * (wv.k > 0.5 ? 1 : -1)) % W + W) % W;
        ctx.fillStyle = `rgba(0,0,12,${(0.06 + 0.3 * chop) * (0.5 + d)})`; ctx.fillRect(x - len / 2, yy + th * 0.6, len, th);
        ctx.fillStyle = rgba(mix(hor, [255, 255, 255], 0.2), (0.06 + 0.4 * chop) * (0.4 + d) * (0.5 + 0.5 * clamp((elev + 5) / 6))); ctx.fillRect(x - len * 0.4, yy, len * 0.8, Math.max(0.6, th * 0.6));
      }
      // whitecaps: appear from ~10 mph (scattered) to everywhere by ~28 mph; they flicker as they break and drift downwind
      const nC = Math.round(G.caps.length * Math.min(1, caps * 1.2));
      if (nC) {
        const bright = 0.25 + 0.65 * clamp((elev + 5) / 8), cc = mix(mix(hor, [120, 124, 140], 0.6), [240, 242, 248], bright);
        const life = Math.floor(ph * 3);
        for (let i = 0; i < nC; i++) {
          const c = G.caps[i], d = Math.pow(c.y, 1.5), yy = hz + 3 + d * (WH - 6);
          const on = ((((i * 7919 + life * 104729) >>> 0) % 1000) / 1000) < 0.55 + 0.4 * caps; if (!on) continue;
          const age = (ph * 3) % 1, wdt = (2 + c.w * 7) * (0.25 + d * 1.8) * H / 300 * (0.7 + 0.5 * caps) * (0.6 + 0.4 * Math.sin(age * 3.14));
          const x = ((c.x * W + ph * 22 * (0.3 + d) * (c.k - 0.3)) % W + W) % W;
          ctx.fillStyle = rgba(cc, (0.3 + 0.4 * c.s) * (0.6 + 0.4 * caps) * (1 - 0.5 * age));
          ctx.beginPath(); ctx.ellipse(x, yy, wdt, Math.max(0.5, wdt * 0.1), 0, 0, 6.283); ctx.fill();
          if (caps > 0.55 && c.s > 0.7) { ctx.fillStyle = rgba(cc, 0.18 * caps); ctx.beginPath(); ctx.ellipse(x + wdt * 0.6, yy + wdt * 0.08, wdt * 1.5, wdt * 0.14, 0, 0, 6.283); ctx.fill(); }   // streaks / spray
        }
      }
    }
    silhouette(ctx, spot, W, H, hz, rng(spot.id + "fg"));
    // fog: only when the forecast has fog codes / visibility < 1 km in the event window
    if (wxOn("fog")) {
      const fc = mix(hor, [196, 196, 204], 0.55), fg = ctx.createLinearGradient(0, hz - H * 0.32, 0, H);
      fg.addColorStop(0, rgba(fc, 0)); fg.addColorStop(0.35, rgba(fc, 0.62)); fg.addColorStop(0.6, rgba(fc, 0.5)); fg.addColorStop(1, rgba(fc, 0.25));
      ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    }
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.85); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(5,3,14,0.55)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // RAINBOW: a rainbow sits opposite the sun, i.e. BEHIND someone facing the sunset/sunrise, so it gets its own
    // "look behind you" panel. Drawn ONLY when the forecast rainbow odds clear the bonus threshold (>= 10%)
    // AND the slider/Play time is inside the forecast rainbow window, with the sun above the horizon.
    const bow = ev.bonus && ev.bonus.bow, bwin = bow && bow.win;
    const bowOn = !!(bow && bow.p >= 10 && bwin && t >= bwin.start && t <= bwin.end && app > -0.3 && elev < 42);
    if (bowOn) rainbowPanel(ctx, W, H, bow, elev, clamp(Math.min(t - bwin.start, bwin.end - t) / 420), lightIn, slant, fall);
    return { elev, phase: phaseOf(elev, ev.timing.dom), lit: L, bow: bowOn, bolt: !!boltNear, sea: SEA };
  }

  // Inset panel: the antisolar sky (behind the viewer) with the rain shaft and the bow.
  // Bow radius 42 deg (red outside, violet inside); its top sits (42 - sun elevation) deg above the horizon,
  // so a low sun gives a tall, near-semicircle bow. Strength follows the forecast odds; a very low sun turns it red.
  function rainbowPanel(ctx, W, H, bow, elev, fade, lightIn, slant, fall) {
    const rise = window.AG_MODE === "sunrise", pw = Math.round(Math.min(W * 0.36, 230)), ph = Math.round(pw * 0.62);
    const x0 = W - pw - 10, y0 = 10, ihz = y0 + ph * 0.8, cx = x0 + pw / 2, rad = pw * 0.38;
    const a = fade * clamp(0.35 + bow.p / 60, 0, 1) * (0.5 + 0.5 * lightIn);
    if (a <= 0.01) return;
    const box = () => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y0, pw, ph, 10); else ctx.rect(x0, y0, pw, ph); };
    ctx.save();
    ctx.globalAlpha = Math.min(1, fade * 1.5);
    box(); ctx.save(); ctx.clip();
    // dark rain-curtain sky opposite the sun, lit warm from behind by the low sun
    const sk = ctx.createLinearGradient(0, y0, 0, ihz); sk.addColorStop(0, "rgb(52,56,78)"); sk.addColorStop(1, bow.red ? "rgb(120,84,92)" : "rgb(96,100,124)");
    ctx.fillStyle = sk; ctx.fillRect(x0, y0, pw, ph);
    ctx.strokeStyle = "rgba(200,205,225,0.22)"; ctx.lineWidth = 1;
    for (let i = 0; i < 34; i++) { const x = x0 + (i * 37 % pw), y = y0 + (((i * 53 % ph) / ph + fall) % 1) * ph * 0.8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + slant * 0.25, y + ph * 0.14); ctx.stroke(); }
    // the bow: centre = antisolar point, below the horizon by the sun's elevation
    const pxDeg = rad / 42, by = ihz + Math.max(0, elev) * pxDeg, bands = bow.red
      ? [[255, 70, 40], [255, 110, 50], [255, 150, 70], [240, 170, 90]]
      : [[255, 40, 40], [255, 140, 30], [255, 230, 60], [70, 200, 80], [60, 120, 255], [110, 70, 210], [150, 70, 200]];
    const bwid = rad * 0.034;
    ctx.globalCompositeOperation = "lighter";
    bands.forEach((c, i) => { ctx.strokeStyle = rgba(c, a * (bow.red && i > 1 ? 0.55 : 0.8)); ctx.lineWidth = bwid * 1.15; ctx.beginPath(); ctx.arc(cx, by, rad - i * bwid, Math.PI, 2 * Math.PI); ctx.stroke(); });
    // brighter sky inside the bow; faint secondary bow (51 deg, reversed colours) when odds are high
    const inG = ctx.createRadialGradient(cx, by, 0, cx, by, rad - bands.length * bwid); inG.addColorStop(0, "rgba(255,255,255,0)"); inG.addColorStop(0.85, `rgba(255,250,240,${0.12 * a})`); inG.addColorStop(1, "rgba(255,250,240,0)");
    ctx.fillStyle = inG; ctx.fillRect(x0, y0, pw, ihz - y0);
    if (bow.p >= 30) bands.slice().reverse().forEach((c, i) => { ctx.strokeStyle = rgba(c, a * 0.22); ctx.lineWidth = bwid * 1.3; ctx.beginPath(); ctx.arc(cx, by, rad * 51 / 42 - i * bwid * 1.3, Math.PI, 2 * Math.PI); ctx.stroke(); });
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgb(14,14,26)"; ctx.fillRect(x0, ihz, pw, ph);   // ground behind you
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; box(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.textBaseline = "bottom";
    const lbl = `🌈 ${bow.red ? "Red rainbow" : "Rainbow"} ${bow.p}% · behind you (${rise ? "W" : "E"})`;
    let fs = Math.max(9, Math.round(ph * 0.1)); ctx.font = `600 ${fs}px system-ui, sans-serif`;
    while (fs > 8 && ctx.measureText(lbl).width > pw - 12) { fs--; ctx.font = `600 ${fs}px system-ui, sans-serif`; }
    ctx.fillText(lbl, x0 + 6, y0 + ph - 4);
    ctx.restore();
  }

  function silhouette(ctx, spot, W, H, hz, r) {
    const k = H / 300;
    if (spot.far) farLayer(ctx, spot.far, W, H, hz, rng(spot.id + "far" + spot.far), k);
    if (landFg(ctx, spot, W, H, hz, r, k)) return;
    ctx.fillStyle = "#07060f"; ctx.strokeStyle = "#07060f";
    const t = spot.type;
    if (t === "Pier" || t === "Boardwalk") {
      const py = hz + 22 * k; ctx.fillRect(0, py, W * 0.42, 5 * k);
      for (let x = 6; x < W * 0.42; x += 18 * k) ctx.fillRect(x, py, 3 * k, H - py);
      ctx.fillRect(0, py - 12 * k, W * 0.42, 2 * k); for (let x = 0; x < W * 0.42; x += 18 * k) ctx.fillRect(x, py - 12 * k, 2 * k, 12 * k);
      ctx.beginPath(); ctx.arc(W * 0.3, py - 22 * k, 4 * k, 0, 6.283); ctx.fill(); ctx.fillRect(W * 0.3 - 3 * k, py - 18 * k, 6 * k, 8 * k);
    } else if (t === "Lighthouse") {
      ctx.beginPath(); ctx.moveTo(W * 0.68, H); ctx.lineTo(W * 0.68, hz + 10 * k); ctx.quadraticCurveTo(W * 0.85, hz - 8 * k, W, hz + 4 * k); ctx.lineTo(W, H); ctx.fill();
      ctx.beginPath(); ctx.moveTo(W * 0.8, hz + 2); ctx.lineTo(W * 0.806, hz - 70 * k); ctx.lineTo(W * 0.824, hz - 70 * k); ctx.lineTo(W * 0.83, hz + 2); ctx.fill();
      ctx.fillRect(W * 0.8, hz - 84 * k, W * 0.03, 14 * k);
      ctx.fillStyle = "rgba(255,240,180,0.95)"; ctx.fillRect(W * 0.806, hz - 80 * k, W * 0.018, 6 * k);
    } else if (t === "Summit" || t === "Bluff") {
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, hz - 12 * k); ctx.quadraticCurveTo(W * 0.18, hz - 30 * k, W * 0.32, hz + 20 * k); ctx.lineTo(W * 0.4, H); ctx.fill();
      ctx.fillStyle = "rgba(20,16,40,0.85)"; ctx.beginPath(); ctx.moveTo(W * 0.55, hz); for (let x = W * 0.55; x <= W; x += 20) ctx.lineTo(x, hz - (6 + r() * 14) * k); ctx.lineTo(W, hz); ctx.fill();
    } else if (t === "Harbor") {
      for (const [x, h] of [[0.12, 70], [0.2, 55], [0.82, 64]]) { const bx = W * x, by = hz + 22 * k; ctx.fillRect(bx, by - h * k, 2 * k, h * k); ctx.beginPath(); ctx.moveTo(bx - 24 * k, by); ctx.lineTo(bx + 26 * k, by); ctx.lineTo(bx + 18 * k, by + 10 * k); ctx.lineTo(bx - 18 * k, by + 10 * k); ctx.fill(); }
    } else if (t === "Dunes" || t === "Marsh") {
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, hz + 22 * k); ctx.quadraticCurveTo(W * 0.3, hz - 4 * k, W * 0.6, hz + 30 * k); ctx.quadraticCurveTo(W * 0.8, hz + 34 * k, W, hz + 24 * k); ctx.lineTo(W, H); ctx.fill();
      ctx.lineWidth = 1.2; for (let i = 0; i < 60; i++) { const x = r() * W; ctx.beginPath(); ctx.moveTo(x, hz + 34 * k); ctx.lineTo(x + (r() - 0.5) * 10, hz + (14 - r() * 18) * k); ctx.stroke(); }
    } else {
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H - 26 * k); ctx.quadraticCurveTo(W * 0.5, H - 42 * k, W, H - 18 * k); ctx.lineTo(W, H); ctx.fill();
      if (spot.state === "FL") {
        const px = W * 0.86, base = H - 22 * k, top = base - 120 * k; ctx.lineWidth = 4 * k; ctx.beginPath(); ctx.moveTo(px, base); ctx.quadraticCurveTo(px - 12 * k, base - 60 * k, px + 4 * k, top); ctx.stroke();
        ctx.lineWidth = 2.5 * k; for (let a = 0; a < 8; a++) { const ang = Math.PI * (0.85 + a * 0.19); ctx.beginPath(); ctx.moveTo(px + 4 * k, top); ctx.quadraticCurveTo(px + 4 * k + Math.cos(ang) * 30 * k, top - 20 * k, px + 4 * k + Math.cos(ang) * 50 * k, top + (Math.abs(Math.sin(ang)) * 14 + 14) * k); ctx.stroke(); }
      } else { ctx.lineWidth = 1.2; for (let i = 0; i < 50; i++) { const x = r() * W; ctx.beginPath(); ctx.moveTo(x, H - 24 * k); ctx.lineTo(x + (r() - 0.5) * 8, H - (34 + r() * 18) * k); ctx.stroke(); } }
    }
  }
  // ---------- Horizon features for the view direction (geography-matched, from window.SCENE) ----------
  function farLayer(ctx, far, W, H, hz, r, k, col) {
    ctx.save(); ctx.fillStyle = col || "rgba(10,9,22,0.92)";
    if (far === "lowshore" || far === "islands") {
      const segs = far === "islands" ? 4 : 1;
      for (let s = 0; s < segs; s++) {
        const x0 = far === "islands" ? W * (0.05 + r() * 0.85) : -10, w = far === "islands" ? W * (0.05 + r() * 0.12) : W + 20, hgt = (far === "islands" ? 4 + r() * 6 : 1.5 + r() * 2) * k;
        ctx.beginPath(); ctx.moveTo(x0, hz + 0.5);
        for (let x = 0; x <= w; x += 6) { const f = x / w, e = far === "islands" ? Math.sin(f * Math.PI) ** 0.6 : 1; ctx.lineTo(x0 + x, hz - hgt * e * (0.7 + 0.3 * r())); }
        ctx.lineTo(x0 + w, hz + 0.5); ctx.fill();
      }
    } else if (far === "skyline") {
      const x0 = W * (0.12 + r() * 0.2), x1 = W * (0.62 + r() * 0.3);
      ctx.fillRect(0, hz - 1.5 * k, W, 2 * k);
      for (let x = x0; x < x1; ) { const bw = (4 + r() * 10) * k, f = 1 - Math.abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2)), bh = (6 + r() * 30 * (0.35 + f)) * k; ctx.fillRect(x, hz - bh, bw, bh + 1); if (r() < 0.12) ctx.fillRect(x + bw * 0.45, hz - bh - 6 * k, 1 * k, 6 * k); x += bw + r() * 2 * k; }
      ctx.fillStyle = "rgba(255,214,150,0.55)"; for (let i = 0; i < 70; i++) { const x = x0 + r() * (x1 - x0), y = hz - (2 + r() * 20) * k; ctx.fillRect(x, y, 1, 1); }
    } else if (far === "bridge") {
      const x0 = W * (0.05 + r() * 0.15), x1 = W * (0.75 + r() * 0.22), dy = hz - 4 * k;
      ctx.fillRect(x0, dy, x1 - x0, 1.6 * k);
      for (let x = x0; x <= x1; x += 9 * k) ctx.fillRect(x, dy, 1 * k, hz - dy);
      const sx = x0 + (x1 - x0) * (0.3 + r() * 0.4); ctx.beginPath(); ctx.moveTo(sx - 30 * k, dy); ctx.quadraticCurveTo(sx, dy - 14 * k, sx + 30 * k, dy); ctx.lineTo(sx + 30 * k, dy + 1.6 * k); ctx.quadraticCurveTo(sx, dy - 12 * k, sx - 30 * k, dy + 1.6 * k); ctx.fill();
    } else if (far === "hills") {
      ctx.beginPath(); ctx.moveTo(0, hz + 1); let y = 0; for (let x = 0; x <= W + 8; x += 8) { y = Math.max(2, Math.min(22, y + (r() - 0.45) * 5)); ctx.lineTo(x, hz - y * k); } ctx.lineTo(W, hz + 1); ctx.fill();
    } else if (far === "trees" || far === "town") {
      ctx.fillRect(0, hz - 3 * k, W, 4 * k);
      for (let x = -4; x < W + 6; ) { const w = (3 + r() * 7) * k, h = (far === "town" ? 3 + r() * 6 : 5 + r() * 11) * k; if (far === "town" && r() < 0.6) { ctx.fillRect(x, hz - h, w * 1.4, h); ctx.beginPath(); ctx.moveTo(x - 1, hz - h); ctx.lineTo(x + w * 0.7, hz - h - 3 * k); ctx.lineTo(x + w * 1.4 + 1, hz - h); ctx.fill(); } else { ctx.beginPath(); ctx.ellipse(x + w / 2, hz - h * 0.6, w * 0.7, h * 0.6, 0, 0, 6.283); ctx.fill(); ctx.fillRect(x + w / 2 - 1, hz - h * 0.6, 2, h * 0.6); } x += w * (far === "town" ? 1.6 : 0.8); }
    }
    ctx.restore();
  }
  // nearby foreground for scene types that aren't water-facing: Town (roofs, poles, palms in FL) and Woods
  function landFg(ctx, spot, W, H, hz, r, k) {
    const t = spot.type; if (t !== "Town" && t !== "Woods") return false;
    ctx.fillStyle = "#07060f"; ctx.strokeStyle = "#07060f";
    if (t === "Woods") {
      for (let x = -20; x < W + 20; ) { const h = (40 + r() * 90) * k, w = (14 + r() * 26) * k; ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + w / 2, hz + 30 * k - h); ctx.lineTo(x + w, H); ctx.fill(); ctx.beginPath(); ctx.ellipse(x + w / 2, hz + 30 * k - h * 0.7, w * 0.8, h * 0.45, 0, 0, 6.283); ctx.fill(); x += w * 0.9; }
    } else {
      ctx.fillRect(0, hz + 6 * k, W, H);
      for (let x = -10; x < W; ) { const w = (26 + r() * 40) * k, h = (14 + r() * 22) * k, b = hz + 14 * k; ctx.fillRect(x, b - h, w, h + H); ctx.beginPath(); ctx.moveTo(x - 3 * k, b - h); ctx.lineTo(x + w / 2, b - h - 12 * k); ctx.lineTo(x + w + 3 * k, b - h); ctx.fill(); x += w + r() * 14 * k; }
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, hz - 8 * k); ctx.quadraticCurveTo(W * 0.5, hz - 2 * k, W, hz - 10 * k); ctx.stroke();
      if (spot.state === "FL" || spot.state === "SC" || spot.state === "GA") for (const px of [W * 0.18, W * 0.74]) { const base = hz + 16 * k, top = base - 90 * k; ctx.lineWidth = 3.5 * k; ctx.beginPath(); ctx.moveTo(px, base); ctx.quadraticCurveTo(px - 8 * k, base - 45 * k, px + 3 * k, top); ctx.stroke(); ctx.lineWidth = 2.2 * k; for (let a = 0; a < 8; a++) { const ang = Math.PI * (0.85 + a * 0.19); ctx.beginPath(); ctx.moveTo(px + 3 * k, top); ctx.quadraticCurveTo(px + 3 * k + Math.cos(ang) * 22 * k, top - 14 * k, px + 3 * k + Math.cos(ang) * 38 * k, top + 12 * k); ctx.stroke(); } }
    }
    return true;
  }

  // ---------- 180° TURN: the sky BEHIND you (facing away from the sun) ----------
  // Antisolar sky: Belt of Venus + Earth's shadow after sunset/before sunrise, front-lit clouds, rain shafts when
  // forecast, and — only when the forecast rainbow odds are >= 10% inside the rainbow window with the sun up — the
  // rainbow drawn IN the scene, centred on the antisolar point (sun elevation below the horizon), 42° radius,
  // secondary bow at 51°. Wide-angle framing so the whole bow fits. Foreground = what's really behind you (SCENE table).
  const BEH_TOP = [[8, [70, 120, 190]], [3, [72, 98, 160]], [0, [70, 78, 130]], [-2, [52, 56, 104]], [-4, [28, 30, 70]], [-7, [9, 11, 32]]];
  const BEH_HOR = [[8, [196, 210, 226]], [3, [214, 196, 196]], [0, [222, 170, 178]], [-1.5, [206, 150, 178]], [-4, [70, 74, 118]], [-7, [18, 20, 44]]];
  function drawBehind(canvas, spot, ev, t) {
    const { sunPos } = window.Model;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 340;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = ev.s, elev = sunPos(t, spot.lat, spot.lng).elev, hz = H * 0.66, k = H / 300;
    const B = Object.assign({ type: "Beach", far: "lowshore", water: true }, spot.behind || {});
    const r = rng(spot.id + "behind" + (window.AG_MODE || ""));
    // sky
    const top = ramp(elev, BEH_TOP), hor = ramp(elev, BEH_HOR);
    const sg = ctx.createLinearGradient(0, 0, 0, hz); sg.addColorStop(0, rgba(top)); sg.addColorStop(0.7, rgba(mix(top, hor, 0.6))); sg.addColorStop(1, rgba(hor));
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, hz);
    // Earth's shadow (blue-grey band rising from the horizon as the sun sinks) under the pink Belt of Venus
    if (elev < 1 && elev > -7) {
      const dep = clamp(-elev / 6), shH = H * (0.02 + 0.16 * dep), belt = clamp(1 - Math.abs(elev + 1.5) / 3.5);
      const bv = ctx.createLinearGradient(0, hz - shH - H * 0.12, 0, hz - shH); bv.addColorStop(0, "rgba(255,170,190,0)"); bv.addColorStop(1, `rgba(255,170,190,${0.45 * belt})`); ctx.fillStyle = bv; ctx.fillRect(0, hz - shH - H * 0.12, W, H * 0.12);
      const es = ctx.createLinearGradient(0, hz - shH, 0, hz); es.addColorStop(0, `rgba(60,66,110,${0.5 * belt + 0.2 * dep})`); es.addColorStop(1, `rgba(44,48,92,${0.75 * (0.4 + 0.6 * dep)})`); ctx.fillStyle = es; ctx.fillRect(0, hz - shH, W, shH);
    }
    // clouds: front-lit by the low sun behind the viewer
    const lit = (dom, km) => { const e = elev + DEPRESS[dom]; return { c: ramp(e, LIGHT), a: clamp((e + 0.6) / 1.2) * clamp(1 - (ev.slotBlock || 0) * 0.8) }; };
    const shade = ramp(elev, SHADE);
    const layer = (frac, dom, y0, y1, n, rx, ry) => { const L = lit(dom); for (let i = 0; i < Math.round(frac * n); i++) { const y = H * (y0 + r() * (y1 - y0)), f = y / hz, x = r() * W, c = mix(shade, L.c, L.a * 0.85); blob(ctx, x, y, rx * W * (0.6 + r() * 0.8) * (1.2 - f * 0.6), ry * H * (0.6 + r() * 0.6), c, 0.55 + r() * 0.3); } };
    layer((s.high || 0) / 100, "high", 0.04, 0.4, 26, 0.16, 0.012);
    layer((s.mid || 0) / 100, "mid", 0.1, 0.5, 34, 0.07, 0.03);
    layer((s.low || 0) / 100, "low", 0.38, 0.6, 30, 0.08, 0.04);
    // weather that is forecast for the window (rain shafts / storm darkening); nothing is drawn if it isn't forecast
    const WX = ev.wx || { items: [], bolt: {}, wind: {} }, wxOn = id => WX.items.some(x => x.id === id);
    const bow = ev.bonus && ev.bonus.bow, bwin = bow && bow.win;
    const bowOn = !!(bow && bow.p >= 10 && bwin && t >= bwin.start && t <= bwin.end && elev > -0.3 && elev < 42);
    const rainy = wxOn("rain") || (s.precip || 0) > 0.1 || bowOn;
    const fall = ((t / 30) % 1 + 1) % 1;
    if (rainy) {
      const cur = ctx.createLinearGradient(0, H * 0.15, 0, hz); cur.addColorStop(0, "rgba(40,44,64,0.0)"); cur.addColorStop(1, "rgba(40,44,64,0.45)"); ctx.fillStyle = cur; ctx.fillRect(0, H * 0.15, W, hz - H * 0.15);
      ctx.strokeStyle = "rgba(205,210,230,0.22)"; ctx.lineWidth = 1; const rr = rng(spot.id + "brain");
      for (let i = 0; i < 160; i++) { const x = rr() * W, y = (rr() + fall) % 1 * hz; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + H * 0.08); ctx.stroke(); }
    }
    // the rainbow, in the scene
    if (bowOn) {
      const fade = clamp(Math.min(t - bwin.start, bwin.end - t) / 420), a = fade * clamp(0.35 + bow.p / 60) * clamp(1 - (ev.slotBlock || 0) * 0.6);
      const pxDeg = Math.min(H * 0.62 / 42, W * 0.47 / 42), cx = W / 2, cy = hz + Math.max(0, elev) * pxDeg, R = 42 * pxDeg, bw = R * 0.03;
      const bands = bow.red ? [[255, 70, 40], [255, 110, 50], [255, 150, 70], [240, 170, 90]] : [[255, 40, 40], [255, 140, 30], [255, 230, 60], [70, 200, 80], [60, 120, 255], [110, 70, 210], [150, 70, 200]];
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();
      const inG = ctx.createRadialGradient(cx, cy, 0, cx, cy, R - bands.length * bw); inG.addColorStop(0, "rgba(255,255,255,0)"); inG.addColorStop(0.8, `rgba(255,250,240,${0.1 * a})`); inG.addColorStop(1, `rgba(255,250,240,${0.16 * a})`); ctx.fillStyle = inG; ctx.fillRect(0, 0, W, hz);
      ctx.fillStyle = `rgba(20,22,40,${0.12 * a})`; ctx.beginPath(); ctx.arc(cx, cy, R * 51 / 42, 0, 6.283); ctx.arc(cx, cy, R, 0, 6.283, true); ctx.fill();   // Alexander's dark band
      ctx.globalCompositeOperation = "lighter";
      bands.forEach((c, i) => { ctx.strokeStyle = rgba(c, a * (bow.red && i > 1 ? 0.5 : 0.75)); ctx.lineWidth = bw * 1.2; ctx.beginPath(); ctx.arc(cx, cy, R - i * bw, Math.PI, 2 * Math.PI); ctx.stroke(); });
      if (bow.p >= 22) bands.slice().reverse().forEach((c, i) => { ctx.strokeStyle = rgba(c, a * 0.22); ctx.lineWidth = bw * 1.3; ctx.beginPath(); ctx.arc(cx, cy, R * 51 / 42 - i * bw * 1.3, Math.PI, 2 * Math.PI); ctx.stroke(); });
      ctx.restore();
    }
    // lightning flash in the storm behind you, only when lightning is forecast in the window
    const bP = (WX.bolt && WX.bolt.p) || 0;
    if (bP >= 25) { const m = Math.floor(t / 40); if ((m * 2654435761 >>> 0) % 7 === 0) { const rb = rng(spot.id + "bb" + m); let x = W * (0.2 + rb() * 0.6), y = H * 0.12; ctx.strokeStyle = "rgba(235,235,255,0.9)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y); while (y < hz) { x += (rb() - 0.5) * 22; y += 10 + rb() * 16; ctx.lineTo(x, Math.min(y, hz)); } ctx.stroke(); ctx.fillStyle = "rgba(200,200,255,0.08)"; ctx.fillRect(0, 0, W, hz); } }
    // ground behind you
    const gb = ctx.createLinearGradient(0, hz, 0, H); gb.addColorStop(0, rgba(mix(hor, [16, 14, 34], 0.55))); gb.addColorStop(1, "rgb(8,8,20)"); ctx.fillStyle = gb; ctx.fillRect(0, hz, W, H - hz);
    if (B.water !== false) {   // water: soft reflection of the antisolar sky (and of the bow)
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.38; ctx.translate(0, 2 * hz * dpr); ctx.scale(1, -1);
      const rh = Math.min(hz, (H - hz) * 1.6); ctx.drawImage(canvas, 0, (hz - rh) * dpr, W * dpr, rh * dpr, 0, (hz - rh) * dpr, W * dpr, rh * dpr); ctx.restore();
      ctx.fillStyle = "rgba(8,8,22,0.35)"; ctx.fillRect(0, hz, W, H - hz);
    }
    farLayer(ctx, B.far, W, H, hz, r, k);
    const fs = Object.assign({}, spot, { type: B.type, far: null, water: B.water });
    if (!landFg(ctx, fs, W, H, hz, r, k)) silhouette(ctx, fs, W, H, hz, r);
    const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.85); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(5,3,14,0.5)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    return { elev, phase: phaseOf(elev, ev.timing.dom), bow: bowOn, rain: rainy, bolt: bP >= 25 };
  }
  // same numbers the drawing uses, without drawing (used by the photoreal stage for its captions)
  function state(spot, ev, t) {
    const elev = window.Model.sunPos(t, spot.lat, spot.lng).elev, lightIn = clamp(1 - ev.slotBlock * 1.05);
    const layerLight = dom => { const e = elev + DEPRESS[dom]; return { c: ramp(e, LIGHT), lit: clamp((e + 0.6) / 1.2) * lightIn }; };
    return { elev, phase: phaseOf(elev, ev.timing.dom), lit: { high: layerLight("high"), mid: layerLight("mid"), low: layerLight("low") } };
  }
  g.Preview = { draw, phaseOf, state, drawBehind };
})(window);
