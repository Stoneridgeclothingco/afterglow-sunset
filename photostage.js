// Spot-detail "predicted sunset" stage: live physically-based render (photoreal.js) for every slider position,
// plus an optional AI photo-finish pass (server-side SD-Turbo img2img of our own render) at key moments of the evening,
// cross-faded as you scrub. Falls back to the old canvas illustration if WebGL2 is missing.
(function (g) {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  // FALLBACK: original canvas illustration (preview.js) is the default; photoreal WebGL + AI photo finish disabled.
  const CANVAS_ONLY = true;
  const live = () => !CANVAS_ONLY && g.Photoreal && g.Photoreal.supported();

  function params(spot, ev, t, opt = {}) {
    const pos = g.Model.sunPos(t, spot.lat, spot.lng), s = ev.s;
    const off = ((pos.az - ev.sunsetAz + 540) % 360) - 180;
    // aerosol: NOAA GOES AOD / CAMS when present, else infer from the clean-air score; humid air swells haze
    let aod = s.aod != null ? s.aod : 0.05 + (1 - ev.clean) * 0.45;
    aod *= 1 + Math.max(0, (ev.rhLow || 60) - 70) / 50;
    const seed = (g.Photoreal ? g.Photoreal.hash : () => 0.5)(spot.id + ":" + ev.tSet);
    return Object.assign({
      elev: pos.elev, sunAzOff: clamp(off + 3, -14, 14),
      high: clamp((s.high || 0) / 100), mid: clamp((s.mid || 0) / 100), low: clamp((s.low || 0) / 100),
      block: clamp(ev.slotBlock || 0), aod: clamp(aod, 0.02, 1.2), rh: (ev.rhLow || 60) / 100,
      water: spot.water !== false, pier: spot.type === "Pier" || spot.type === "Boardwalk",
      shore: spot.water !== false && spot.obst >= 0.5 ? clamp(spot.obst / 2, 0.25, 1) : 0,
      hills: spot.water === false ? 1 : 0,
      camH: spot.type === "Summit" ? 0.47 : spot.type === "Bluff" ? 0.025 : spot.type === "Dunes" ? 0.03 : 0.0025,
      seed, wind: seed * 6.283, dog: ev.dog && ev.dog.p >= 15 && pos.elev > 0.3 && pos.elev < 15 ? clamp(ev.dog.p / 60) : 0,
    }, opt);
  }

  function draw(canvas, spot, ev, t, opt = {}) {
    const lit = g.Preview.state ? g.Preview.state(spot, ev, t) : null;
    const P = params(spot, ev, t, opt); g.PhotoStage && (g.PhotoStage.last = P);
    if (live() && g.Photoreal.render(canvas, P)) return Object.assign({ mode: "live" }, lit);
    const o = g.Preview.draw(canvas, spot, ev, t); o.mode = "canvas"; return o;
  }

  // ---------- AI photo-finish keyframes ----------
  let api = null;
  async function apiOK() {
    if (CANVAS_ONLY) return false;
    if (api !== null) return api;
    try { const r = await fetch("api/health", { cache: "no-store" }); api = r.ok ? await r.json() : false; } catch (e) { api = false; }
    return api;
  }
  function phaseWords(e) {
    if (e > 4) return "golden hour, low warm sun, long golden light";
    if (e > 1) return "late golden hour, sun low above the horizon, warm orange light";
    if (e > -0.9) return "sunset, the sun touching the horizon, glowing orange horizon";
    if (e > -2.5) return "just after sunset, afterglow, clouds lit from below in vivid orange, pink and red";
    if (e > -4.5) return "late afterglow, twilight, pink and magenta clouds fading, deep blue sky above";
    return "blue hour dusk, deep blue sky, soft smooth dim clouds, last thin band of orange on the horizon, long exposure, clean noise-free sky";
  }
  function prompt(spot, ev, P) {
    const c = [];
    if (P.high > 0.12) c.push(P.high > 0.6 ? "a thin veil of cirrostratus with cirrus streaks" : "wispy cirrus streaks high in the sky");
    if (P.mid > 0.12) c.push(P.mid > 0.6 ? "a broad altocumulus cloud deck" : "scattered altocumulus clouds");
    if (P.low > 0.2) c.push("low stratocumulus clouds");
    if (P.block > 0.45) c.push("a dark cloud bank along the western horizon");
    if (!c.length) c.push("a clear cloudless sky with a smooth color gradient");
    const scene = P.water ? (P.pier ? "calm water with the silhouette of a long wooden fishing pier" : spot.type === "Harbor" ? "a calm harbor with a distant low shoreline" : "calm open water to the horizon") : spot.type === "Summit" ? "layered distant mountain ridges from a summit" : "a coastal landscape";
    const air = P.aod > 0.3 ? "hazy air, softened colors" : P.aod < 0.12 ? "crisp clean air, saturated colors" : "";
    return `a real photograph of a ${phaseWords(P.elev)} over ${scene}, ${c.join(", ")}${air ? ", " + air : ""}, natural colors, landscape photography, shot on a full-frame DSLR, 24mm, sharp, highly detailed, realistic`;
  }
  // key moments chosen by sun elevation so neighbours differ only a little (cross-fades stay clean)
  function keyTimes(spot, ev, t0, t1, peak) {
    const targets = [6, 3, 1, -0.5, -1.6, -2.8, -4, -5.5];
    const out = [];
    for (const tg of targets) {
      let best = null, bd = 1e9;
      for (let t = t0; t <= t1; t += 20) { const d = Math.abs(g.Model.sunPos(t, spot.lat, spot.lng).elev - tg); if (d < bd) { bd = d; best = t; } }
      if (best != null && bd < 0.4) out.push(best);
    }
    if (peak && !out.some(t => Math.abs(t - peak) < 120)) out.push(peak);
    return out.sort((a, b) => a - b);
  }
  const cache = {};   // key -> [{t, url}]
  function photoSet(spot, ev) { const k = spot.id + ":" + ev.tSet; return cache[k] || (cache[k] = { frames: [], busy: false, gen: 0 }); }

  async function ensurePhotos(spot, ev, t0, t1, peak, aspect, onReady) {
    const set = photoSet(spot, ev);
    if (!(await apiOK())) return set;
    if (set.busy) { set.onReady = onReady; return set; }
    set.busy = true; set.onReady = onReady;
    const times = keyTimes(spot, ev, t0, t1, peak);
    // order: best minute first, then outward
    times.sort((a, b) => Math.abs(a - peak) - Math.abs(b - peak));
    const W = aspect >= 1 ? 640 : Math.round(640 * aspect / 8) * 8, H = aspect >= 1 ? Math.round(640 / aspect / 8) * 8 : 640;
    const cv = document.createElement("canvas");
    for (const t of times) {
      if (set.frames.some(f => f.t === t)) continue;
      const P = params(spot, ev, t, { w: W, h: H, grain: 0 });
      if (!g.Photoreal.render(cv, P)) break;
      const img = cv.toDataURL("image/png");
      try {
        const r = await fetch("api/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ img, prompt: prompt(spot, ev, P), strength: P.elev < -4.3 ? 0.3 : 0.45, seed: Math.floor(P.seed * 1e6) }) });
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        const im = new Image(); im.src = j.url; await im.decode().catch(() => {});
        set.frames.push({ t, url: j.url, elev: P.elev }); set.frames.sort((a, b) => a.t - b.t);
        set.onReady && set.onReady(set);
      } catch (e) { console.warn("photo-finish failed", e); break; }
    }
    set.busy = false; set.done = true; set.onReady && set.onReady(set);
    return set;
  }
  // which photo frames to show at time t: [{url, a}] bottom→top
  function photoMix(set, t) {
    const F = set.frames; if (!F.length) return null;
    let a = null, b = null;
    for (const f of F) { if (f.t <= t) a = f; if (f.t >= t && !b) b = f; }
    if (a && b) { if (a === b) return [[a.url, 1]]; const w = (t - a.t) / (b.t - a.t), s = w * w * (3 - 2 * w); return [[a.url, 1], [b.url, clamp((s - 0.2) / 0.6)]]; }
    const f = a || b; return Math.abs(f.t - t) < 150 ? [[f.url, 1]] : null;
  }
  g.PhotoStage = { draw, params, prompt, apiOK, ensurePhotos, photoMix, photoSet, keyTimes, live };
})(window);
