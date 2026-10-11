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

    // 6) ground: water mirrors the sky, land is a silhouette
    const wb = ctx.createLinearGradient(0, hz, 0, H); wb.addColorStop(0, rgba(mix(hor, [16, 14, 34], 0.5))); wb.addColorStop(1, "rgb(8,8,20)");
    ctx.fillStyle = wb; ctx.fillRect(0, hz, W, H - hz);
    if (spot.water !== false) {
      const rh = Math.min(hz, (H - hz) * 1.6);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.42;
      ctx.translate(0, 2 * hz * dpr); ctx.scale(1, -1);
      ctx.drawImage(canvas, 0, (hz - rh) * dpr, W * dpr, rh * dpr, 0, (hz - rh) * dpr, W * dpr, rh * dpr);
      ctx.restore();
      const dk = ctx.createLinearGradient(0, hz, 0, H); dk.addColorStop(0, "rgba(8,8,22,0.05)"); dk.addColorStop(1, "rgba(8,8,22,0.75)"); ctx.fillStyle = dk; ctx.fillRect(0, hz, W, H - hz);
      // sun glitter path
      const gl = clamp((elev + 1.5) / 4) * lightIn * (1 - haze);
      for (const rp of G.ripples) {
        const yy = hz + 2 + rp.y * (H - hz), d = (yy - hz) / (H - hz), w = (20 + rp.w * 50) * (0.4 + d * 2) * H / 300;
        ctx.fillStyle = rgba(ramp(elev, LIGHT), gl * 0.6 * (1 - d * 0.6)); ctx.fillRect(sunX - w / 2 + rp.j * 30 * d, yy, w, 1.4);
        ctx.fillStyle = `rgba(0,0,10,${0.12 + 0.1 * d})`; ctx.fillRect((rp.w * 1.7 % 1) * W - 40, yy + 3, 80 + rp.j * 60, 1.2);
      }
    }
    if (spot.water !== false && windMph >= 15) {   // whitecaps on windy water
      const rw = rng(spot.id + "caps"), n = Math.round(clamp((windMph - 12) / 20) * 60) + 10;
      ctx.fillStyle = "rgba(230,235,245,0.35)"; for (let i = 0; i < n; i++) { const d = rw(), yy = hz + 4 + d * d * (H - hz - 6); ctx.fillRect(rw() * W, yy, (3 + rw() * 10) * (0.4 + d * 1.6), 1.2); }
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
    return { elev, phase: phaseOf(elev, ev.timing.dom), lit: L, bow: bowOn, bolt: !!boltNear };
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
    const k = H / 300; ctx.fillStyle = "#07060f"; ctx.strokeStyle = "#07060f";
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
  // same numbers the drawing uses, without drawing (used by the photoreal stage for its captions)
  function state(spot, ev, t) {
    const elev = window.Model.sunPos(t, spot.lat, spot.lng).elev, lightIn = clamp(1 - ev.slotBlock * 1.05);
    const layerLight = dom => { const e = elev + DEPRESS[dom]; return { c: ramp(e, LIGHT), lit: clamp((e + 0.6) / 1.2) * lightIn }; };
    return { elev, phase: phaseOf(elev, ev.timing.dom), lit: { high: layerLight("high"), mid: layerLight("mid"), low: layerLight("low") } };
  }
  g.Preview = { draw, phaseOf, state };
})(window);
