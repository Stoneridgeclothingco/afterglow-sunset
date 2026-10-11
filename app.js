(function () {
  // Mode: ?mode=sunrise | ?mode=sunset. No mode → the "Welcome to Afterglow" homepage (index.html) handles the choice.
  const MODE = new URLSearchParams(location.search).get("mode");
  if (MODE !== "sunrise" && MODE !== "sunset") return;
  const RISE = MODE === "sunrise";
  window.AG_MODE = MODE;
  document.body.classList.add("mode-" + MODE);
  const EV = RISE ? "sunrise" : "sunset", Ev = RISE ? "Sunrise" : "Sunset", DIRW = RISE ? "East" : "West", dirw = RISE ? "east" : "west";
  const { evaluate, label, likely, offset, sunPos } = window.Model;
  // Same spots in both modes; sunrise swaps in each spot's EAST-facing view (arc / obstruction / water / note).
  const SPOTS = RISE ? window.SPOTS.map(sp => { const v = (window.SUNRISE_VIEW || {})[sp.id] || [60, 150, 2, false, ""]; return Object.assign({}, sp, { arc: [v[0], v[1]], obst: v[2], water: v[3], note: v[4] || sp.note, setNote: sp.note }); }) : window.SPOTS;
  const PLAY = RISE ? "▶ Play the morning" : "▶ Play the evening";
  // phase names from the canvas preview are sunset-worded; mirror them for mornings
  const phaseName = p => !RISE ? p : ({ "Sunset": "Sunrise", "Afterglow": "First color", "Blue hour": "Blue hour (dawn)" }[p] || p);
  const REGIONS = {
    all: { name: "All coast", states: null },
    ne: { name: "New England", states: ["ME", "NH", "MA", "RI", "NY"] },
    ma: { name: "Mid-Atlantic", states: ["NJ", "DE", "MD", "VA"] },
    se: { name: "Carolinas & GA", states: ["NC", "SC", "GA"] },
    fl: { name: "Florida", states: ["FL"] },
  };
  const state = { day: 0, region: "all", spot: null, data: null, results: [], userLoc: null, overlay: "none" };
  const $ = s => document.querySelector(s);
  const API = "https://api.open-meteo.com/v1/forecast";
  const SPOT_VARS = "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,temperature_2m,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,precipitation_probability,weather_code,cape,pressure_msl,relative_humidity_850hPa,relative_humidity_500hPa,relative_humidity_300hPa";
  const WEST_VARS = "cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation";
  const EAST_VARS = "precipitation,precipitation_probability,weather_code,cloud_cover_low,cloud_cover_mid";

  // Sample points ~80 km toward the sunset (sun's path through the horizon) and ~25 km opposite (rainbow side)
  const nowT = Date.now() / 1000;
  SPOTS.forEach(sp => {
    // azimuth at approx local sunset today: search for elevation crossing
    let t = Math.floor(nowT / 86400) * 86400 + (RISE ? 5 : 12) * 3600, az = RISE ? 90 : 270;
    for (let k = 0; k < 160; k++) { const p = sunPos(t + k * 300, sp.lat, sp.lng); if (RISE ? (p.elev > 0 && k > 0) : (p.elev < 0 && k > 0)) { az = p.az; break; } }
    sp.az = az; sp.west = offset(sp.lat, sp.lng, az, 80); sp.path = [40, 120, 200].map(km => offset(sp.lat, sp.lng, az, km)); sp.east = offset(sp.lat, sp.lng, (az + 180) % 360, 12);
  });

  // Open-Meteo free tier: 600 weighted calls/min, 5000/hour per IP. One mode load is ~300 weighted calls
  // (47 spots + 141 path points + AQ), so we share spot data across modes, cache longer, back off on errors,
  // and never dead-end: stale cache -> best-match -> baked NOAA snapshot shipped with the site.
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  async function fetchBatch(points, hourly, daily, base = API, models, tries = 3) {
    const p = new URLSearchParams({
      latitude: points.map(x => x.lat).join(","), longitude: points.map(x => x.lng).join(","),
      hourly, timezone: "auto", timeformat: "unixtime", forecast_days: "7",
      temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "mm",
    });
    if (daily) p.set("daily", daily);
    if (models) p.set("models", models);
    if (base !== API) ["temperature_unit", "wind_speed_unit", "precipitation_unit"].forEach(k => p.delete(k));
    let last = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);   // Open-Meteo sometimes never answers
        try {
          const r = await fetch(`${base}?${p}`, { signal: ctl.signal });
          if (r.ok) { const j = await r.json(); return Array.isArray(j) ? j : [j]; }
          last = new Error("Open-Meteo HTTP " + r.status); last.status = r.status;
          if (r.status === 429) break;                     // rate-limited: retrying only burns more quota
        } finally { clearTimeout(to); }
      } catch (e) { last = e; }                            // network / CORS-less 429 / timeout
      if (attempt < tries - 1) await sleep(1200 * (attempt + 1));
    }
    throw last || new Error("Open-Meteo request failed");
  }
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { try { Object.keys(localStorage).filter(x => x.startsWith("afterglow-v")).forEach(x => localStorage.removeItem(x)); localStorage.setItem(k, JSON.stringify(v)); } catch (e2) {} } };
  const FRESH = 45 * 60 * 1000, STALE_OK = 12 * 3600 * 1000;

  async function loadData() {
    // Cache is keyed to the exact spot list: adding/reordering spots must never reuse old index-aligned arrays.
    const sig = SPOTS.map(s => s.id).join("|"), n = SPOTS.length;
    const BK = "afterglow-v15-base", DK = "afterglow-v15-" + MODE;
    Object.keys(localStorage).filter(k => k.startsWith("afterglow-v") && !k.startsWith("afterglow-v15-")).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    const okB = c => c && c.sig === sig && c.S && c.S.length === n;
    const okD = c => c && c.sig === sig && c.W && c.W.length === n * 3 && c.E && c.E.length === n;
    let B = lsGet(BK), D = lsGet(DK);
    const fresh = c => c && Date.now() - c.at < FRESH;
    const join = (b, dd, extra) => Object.assign({ at: Math.min(b.at, dd.at), sig, S: b.S, AQ: b.AQ, fcModel: b.fcModel, W: dd.W, E: dd.E }, extra || {});
    if (okB(B) && okD(D) && fresh(B) && fresh(D)) return join(B, D);
    // Primary: NOAA HRRR (0–48 h, 3 km) blended into NOAA GFS (days 3–7) — Open-Meteo "gfs_seamless" mirror of NOAA NOMADS output.
    const getB = async models => {
      const S = await fetchBatch(SPOTS, SPOT_VARS, "sunset,sunrise", API, models);
      let AQ = null; try { AQ = await fetchBatch(SPOTS, "aerosol_optical_depth,pm2_5,dust", null, "https://air-quality-api.open-meteo.com/v1/air-quality", null, 1); } catch (e) { console.warn("AQ unavailable", e); }
      return { at: Date.now(), sig, S, AQ, fcModel: models ? "noaa" : "fallback" };
    };
    const getD = async models => { const [W, E] = await Promise.all([fetchBatch(SPOTS.flatMap(s => s.path), WEST_VARS, null, API, models), fetchBatch(SPOTS.map(s => s.east), EAST_VARS, null, API, models)]); return { at: Date.now(), sig, W, E }; };
    const tryLive = async models => {
      const [b, dd] = await Promise.all([okB(B) && fresh(B) ? B : getB(models), okD(D) && fresh(D) ? D : getD(models)]);
      if (b !== B) lsSet(BK, b); if (dd !== D) lsSet(DK, dd);
      return join(b, dd);
    };
    let err;
    // Live budget: if Open-Meteo hasn't answered in 10 s, show cached/snapshot data now; the live fetch keeps going and refreshes the cache.
    const live = tryLive("gfs_seamless");
    try { return await Promise.race([live, sleep(10000).then(() => { const e = new Error("Open-Meteo too slow"); e.slow = true; throw e; })]); }
    catch (e) { err = e; console.warn("NOAA HRRR/GFS mirror failed/slow", e); live.catch(() => {}); }
    // 1) recent cache (even if past the 45-min refresh window)
    if (okB(B) && okD(D) && Date.now() - Math.min(B.at, D.at) < STALE_OK) return join(B, D, { stale: true });
    // 2) Open-Meteo best-match (skip if we were rate-limited — it hits the same quota)
    if (!(err && (err.status === 429 || err.slow))) { try { return Object.assign(await tryLive(null), {}); } catch (e) { console.warn("best-match fallback failed", e); } }
    // 3) NOAA snapshot baked into the site at deploy time
    try {
      const v = Math.floor(Date.now() / 600000);
      const [sb, sd] = await Promise.all(["base", MODE].map(x => fetch(`data/snap-${x}.json?_=${v}`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })));
      if (okB(sb) && okD(sd)) return join(sb, sd, { snapshot: true });
      console.warn("snapshot does not match spot list");
    } catch (e) { console.warn("snapshot unavailable", e); }
    // 4) any cache at all
    if (okB(B) && okD(D)) return join(B, D, { stale: true });
    throw err;
  }


  // ---------- NOAA direct data (written by noaa/fetch_noaa.py on the host) ----------
  async function loadNoaa() {
    try { const r = await fetch("data/noaa.json?_=" + Math.floor(Date.now() / 60000), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    catch (e) { console.warn("NOAA direct feed unavailable", e); return null; }
  }
  // Overwrite model hours with HRRR values pulled straight from NOAA's HRRR grib2 (AWS Open Data); GOES-19 AOD for tonight.
  function applyNoaa(d, N) {
    d.prov = {};
    if (!N) return;
    const hrs = N.hrrr && N.hrrr.hours || {};
    const setH = (h, k, t, v) => { if (v == null || !h[k]) return false; const i = h.time.indexOf(+t); if (i < 0) return false; h[k][i] = v; return true; };
    SPOTS.forEach((sp, i) => {
      const P = d.prov[sp.id] = { hrrrHours: [] };
      for (const [t, pts] of Object.entries(hrs)) {
        const x = pts[sp.id]; if (!x) continue;
        const h = d.S[i].hourly; let ok = false;
        ok = setH(h, "cloud_cover_low", t, x.low) | setH(h, "cloud_cover_mid", t, x.mid) | setH(h, "cloud_cover_high", t, x.high) | setH(h, "cloud_cover", t, x.total);
        setH(h, "visibility", t, x.vis_m); setH(h, "relative_humidity_2m", t, x.rh2m); setH(h, "precipitation", t, x.prate_mmh);
        if (!RISE) [40, 120, 200].forEach((km, k) => { const y = pts[`${sp.id}@${km}`], w = d.W[i * 3 + k] && d.W[i * 3 + k].hourly; if (y && w) { setH(w, "cloud_cover_low", t, y.low); setH(w, "cloud_cover_mid", t, y.mid); setH(w, "cloud_cover_high", t, y.high); setH(w, "precipitation", t, y.prate_mmh); } });
        if (ok) P.hrrrHours.push(+t);
      }
      // GOES-19 ABI AOD (observed today) → tonight's haze input
      let g = N.goes && N.goes.points && N.goes.points[sp.id], aodWhere = "at the spot";
      if (g && (g.aod == null || (g.aod_n || 0) < 5)) {   // cloud over the spot: use nearest clear-pixel retrievals along the sunset line
        const alt = RISE ? [] : [40, 120, 200].map(km => [km, N.goes.points[`${sp.id}@${km}`]]).filter(([, x]) => x && x.aod != null && x.aod_n >= 5);
        if (alt.length) { g = { aod: alt[0][1].aod, aod_n: alt[0][1].aod_n }; aodWhere = `${alt[0][0]} km toward ${EV} (spot cloud-covered)`; } else g = null;
      }
      if (g && g.aod != null && (g.aod_n || 0) >= 5) {
        if (!d.AQ) d.AQ = [];
        if (!d.AQ[i]) d.AQ[i] = { hourly: { time: d.S[i].hourly.time.slice(), aerosol_optical_depth: d.S[i].hourly.time.map(() => null), pm2_5: d.S[i].hourly.time.map(() => null), dust: d.S[i].hourly.time.map(() => null) } };
        const ah = d.AQ[i].hourly, t0 = d.S[i].daily[EV][0];
        ah.time.forEach((t, k) => { if (Math.abs(t - t0) <= 3 * 3600) ah.aerosol_optical_depth[k] = g.aod; });
        P.goesAod = { v: g.aod, t0, where: aodWhere };
      }
    });
  }
  // Where each number for this spot/day came from
  function provenance(r) {
    const P = (state.data.prov || {})[r.spot.id] || {}, N = state.noaa, tSet = r.ev.tSet;
    const direct = (P.hrrrHours || []).some(t => Math.abs(t - tSet) < 3600);
    const fb = state.data.fcModel === "fallback";
    const cyc = N && N.hrrr ? new Date(N.hrrr.cycle_utc).toISOString().slice(11, 13) + "Z" : "";
    const clouds = fb ? { k: "fb", t: "Open-Meteo best-match (fallback, not NOAA)" } : direct ? { k: "model", t: `NOAA HRRR ${cyc} run — direct grib2 (AWS)` } : state.day <= 1 ? { k: "model", t: "NOAA HRRR via Open-Meteo mirror" } : { k: "model", t: "NOAA GFS via Open-Meteo mirror" };
    const aod = P.goesAod && state.day === 0 ? { k: "obs", t: `NOAA GOES-19 ABI AOD ${P.goesAod.where} (observed ${fmtClock(N.goes.products.AOD.scan_utc)})` } : r.ev.s.aod != null ? { k: "fb", t: "CAMS forecast (fallback, not NOAA)" } : { k: "est", t: "not available — visibility/RH used instead" };
    return { clouds, path: clouds, vis: clouds, rh: clouds, aod, pm: r.ev.s.pm25 != null ? { k: "fb", t: "CAMS forecast (fallback, not NOAA)" } : { k: "est", t: "n/a" },
      sun: { k: "calc", t: "NOAA solar position algorithm (astronomical)" }, types: state.day === 0 && N && N.goes ? { k: "obs", t: "NOAA GOES-19 cloud phase + top height (observed now) + HRRR" } : { k: "est", t: "Estimated from HRRR/GFS layer cover" },
      front: { k: "est", t: "Estimate from NOAA model dew-point/pressure series" } };
  }
  const fmtClock = iso => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
  const tag = p => p ? `<span class="src ${p.k}" title="${p.t}">${{ obs: "NOAA obs", model: "NOAA model", calc: "Astronomical", est: "Estimate", fb: "Fallback" }[p.k]}</span>` : "";
  // Cloud genus from NOAA observations (tonight): GOES-19 phase + cloud-top height, HRRR cloud base
  function noaaCloudTypes(r) {
    const N = state.noaa; if (state.day !== 0 || !N || !N.goes) return null;
    const g = N.goes.points[r.spot.id] || {}, s = r.ev.s, out = [];
    const ph = g.phase || {}, ice = ph.ice || 0, liq = (ph.liquid || 0) + (ph.supercooled || 0);
    if (s.high >= 5) out.push({ level: "High", type: g.cth_km_med >= 6 && ice > 0.5 ? (s.high > 75 ? "Cirrostratus (GOES: ice, tops " + g.cth_km_med.toFixed(1) + " km)" : "Cirrus (GOES: ice, tops " + g.cth_km_med.toFixed(1) + " km)") : (s.high > 75 ? "Cirrostratus" : "Cirrus") + " (not seen by GOES now)", cover: s.high });
    if (s.mid >= 5) out.push({ level: "Mid", type: (s.mid < 50 ? "Altocumulus" : "Altostratus") + ((g.obs_mid || 0) > 0.2 ? ` (GOES: ${(ph.mixed || 0) + (ph.supercooled || 0) > 0.3 ? "mixed/supercooled" : "mid"} tops)` : ""), cover: s.mid });
    if (s.low >= 5 || g.low_stratus_fog) out.push({ level: "Low", type: g.low_stratus_fog ? "Stratus / fog (GOES: liquid tops < 2 km)" : r.ev.clouds.find(c => c.level.startsWith("Low"))?.type || "Stratocumulus", cover: s.low });
    return out.length ? out : null;
  }
  const fmtTime = (t, tz) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(new Date(t * 1000));
  const fmtDay = (t, tz, i) => i === 0 ? (RISE ? "Today" : "Tonight") : i === 1 ? "Tomorrow" : new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(new Date(t * 1000));
  const fmtDate = (t, tz) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(new Date(t * 1000));
  const compass = d => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];
  const confidence = i => i === 0 ? { t: "Higher confidence", c: "hi" } : i <= 2 ? { t: "Moderate confidence", c: "md" } : { t: "Low confidence (day " + (i + 1) + ")", c: "lo" };
  const dist = (a, b) => { const R = 3958.8, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

  // ---------- Bonus: rainbows & sun dogs ----------
  const BONUS_MIN = 10;   // below this the odds are "near zero" → greyed / hidden
  const bonusCls = p => p >= 40 ? "hi" : p >= 22 ? "md" : p >= BONUS_MIN ? "lo" : "no";
  const bonusWord = p => p >= BONUS_MIN ? likely(p) : "Near zero";
  const durTxt = m => m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0).replace(/\.0$/, "") + " h" : m + " min";
  const hm = (t, tz) => fmtTime(t, tz).replace(/ [A-Z]{2,4}$/, "");
  function bonusCard(b, r, opts = {}) {
    const c = bonusCls(b.p), when = b.p >= BONUS_MIN && b.t ? fmtTime(b.t, r.tz) : null;
    return `<div class="bcard ${b.id} ${c}${b.red ? " red" : ""}"${opts.spot ? ` data-id="${r.spot.id}"` : ""}>
      <div class="bc-ic">${b.icon}</div>
      <div class="bc-main"><div class="bc-k">${opts.kicker || "Bonus"}</div><div class="bc-n">${b.name}${opts.spot ? ` <small>· ${r.spot.name}, ${r.spot.state}</small>` : ""}</div>
      <div class="bc-why">${opts.short ? (b.p >= BONUS_MIN ? (b.win ? `Starts ${hm(b.win.start, r.tz)} · lasts ~${durTxt(b.win.min)} · look ${b.look.split(",")[0]}` : `Look ${b.look}${when ? " ~" + when : ""}`) : (b.id === "bow" ? `Too little rain opposite the sun — rainbow odds near zero everywhere` : "Not enough thin ice cloud near a low sun — sun-dog odds near zero everywhere")) : b.why + (when ? ` <em>Best ~${when}</em>` : "")}</div></div>
      ${!opts.short && b.win && b.p >= BONUS_MIN ? `<div class="bc-win"><div><span>Starts</span><b>${hm(b.win.start, r.tz)}</b></div><div><span>Lasts</span><b>~${durTxt(b.win.min)}</b></div><div><span>Ends</span><b>${hm(b.win.end, r.tz)}</b></div><div><span>Look</span><b>${b.look.split(",")[0]}</b></div></div>` : ""}
      <div class="bc-p"><b>${b.p}%</b><span>${bonusWord(b.p)}</span></div>
      <div class="bc-bar"><i style="width:${Math.max(2, b.p)}%"></i></div></div>`;
  }
  function renderBonus(list) {
    const box = $("#bonus"); if (!box) return;
    const best = id => list.slice().sort((a, b) => b.ev.bonus[id].p - a.ev.bonus[id].p)[0];
    const bw = best("bow"), dg = best("dog"); if (!bw) { box.innerHTML = ""; return; }
    const nb = list.filter(r => r.ev.bonus.bow.p >= BONUS_MIN).length, nd = list.filter(r => r.ev.bonus.dog.p >= BONUS_MIN).length;
    box.innerHTML = `<div class="bonus-h">✨ Special bonus · ${state.day === 0 ? (RISE ? "this morning" : "tonight") : state.day === 1 ? (RISE ? "tomorrow morning" : "tomorrow night") : fmtDay(list[0].ev.tSet, list[0].tz, state.day)}<small>${nb} spot${nb === 1 ? "" : "s"} with rainbow odds · ${nd} with sun dogs</small></div>
      ${bonusCard(bw.ev.bonus.bow, bw, { spot: true, short: true, kicker: "Best rainbow odds" })}
      ${bonusCard(dg.ev.bonus.dog, dg, { spot: true, short: true, kicker: "Best sun-dog odds" })}
      ${(() => { const tri = list.filter(r => r.ev.tri.on); if (tri.length) return tri.slice(0, 3).map(r => trifectaCard(r, { spot: true })).join("");
        const c = list.slice().sort((a, b) => (b.ev.tri.n - a.ev.tri.n) || ((b.ev.score / EP.color + b.ev.tri.bow / EP.bow + b.ev.tri.bolt / EP.bolt) - (a.ev.score / EP.color + a.ev.tri.bow / EP.bow + a.ev.tri.bolt / EP.bolt)))[0];
        return trifectaCard(c, { spot: true }); })()}`;
    box.querySelectorAll(".bcard[data-id],.tricard[data-id]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.id)));
  }

  // ---------- Weather during the event + Trifecta ----------
  // Little icons under each map pin: 🌈 rainbow odds ≥ 10% (bold at ≥ 22%), ⚡ lightning odds ≥ 25% in the event window,
  // then rain / wind / fog / overcast / snow if forecast during the window.
  function pinIcons(r) {
    const B = r.ev.bonus, out = [];
    if (B.bow.p >= BONUS_MIN) out.push({ i: "🌈", c: "bow " + bonusCls(B.bow.p), t: `Rainbow ${B.bow.p}%` });
    r.ev.wx.items.forEach(w => out.push({ i: w.icon, c: w.id + (w.id === "bolt" && w.p >= 40 ? " hi" : ""), t: w.name }));
    return out.slice(0, 3);
  }
  const wxChip = w => `<span class="tag wx ${w.id}">${w.icon} ${w.name}${w.p ? " " + w.p + "%" : ""}</span>`;
  const EP = window.Model.EPIC;
  const legTxt = T => `${T.legs.color ? "✓" : "✗"} ${Ev} ${T.color}/${EP.color} · ${T.legs.bow ? "✓" : "✗"} Rainbow ${T.bow}%/${EP.bow}% · ${T.legs.bolt ? "✓" : "✗"} Lightning ${T.bolt}%/${EP.bolt}%`;
  function trifectaCard(r, opts = {}) {
    const T = r.ev.tri;
    if (T.on) return `<div class="tricard on"${opts.spot ? ` data-id="${r.spot.id}"` : ""}><div class="tri-ic">✦</div><div><div class="tri-k">Trifecta${opts.spot ? ` · ${r.spot.name}, ${r.spot.state}` : ""}</div>
      <div class="tri-n">Epic ${EV} + epic rainbow + epic lightning</div><div class="tri-w">${hm(T.start, r.tz)}–${hm(T.end, r.tz)} · ${legTxt(T)}</div></div><div class="tri-badge">🌅🌈⚡</div></div>`;
    return `<div class="tricard"${opts.spot ? ` data-id="${r.spot.id}"` : ""}><div class="tri-ic off">✦</div><div><div class="tri-k">Trifecta watch${opts.spot ? ` · closest: ${r.spot.name}, ${r.spot.state}` : ""}</div>
      <div class="tri-n">${T.n}/3 epic${T.n === 3 && !T.lined ? " — but rainbow & lightning don't overlap in time" : ""}</div><div class="tri-w">${legTxt(T)}</div></div></div>`;
  }

  // ---------- Map ----------
  const map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 4 }).setView([34.5, -77.5], 5);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors", maxZoom: 16 }).addTo(map);
  map.createPane("labels"); map.getPane("labels").style.zIndex = 450; map.getPane("labels").style.pointerEvents = "none";
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { pane: "labels", maxZoom: 16 }).addTo(map);
  const overlays = {
    vis: L.tileLayer(Sat.tileUrl("vis"), { opacity: 0.7, attribution: "GOES-East via Iowa Env. Mesonet", maxNativeZoom: 8 }),
    cirrus: L.tileLayer(Sat.tileUrl("cirrus"), { opacity: 0.7, attribution: "GOES-East via Iowa Env. Mesonet", maxNativeZoom: 8 }),
    ir: L.tileLayer(Sat.tileUrl("ir"), { opacity: 0.6, attribution: "GOES-East via Iowa Env. Mesonet", maxNativeZoom: 8 }),
    radar: L.tileLayer(Sat.tileUrl("radar"), { opacity: 0.7, attribution: "NEXRAD via Iowa Env. Mesonet", maxNativeZoom: 8 }),
  };
  document.querySelectorAll("[data-overlay]").forEach(b => b.addEventListener("click", () => {
    const o = b.dataset.overlay; state.overlay = o;
    Object.values(overlays).forEach(l => map.removeLayer(l));
    if (overlays[o]) overlays[o].addTo(map);
    document.querySelectorAll("[data-overlay]").forEach(x => x.classList.toggle("on", x === b));
    $("#overlay-note").textContent = { none: "", vis: "Live GOES-East visible (daytime only) — bright = thick cloud.", cirrus: "Live GOES-East band 4 cirrus — bright = thin high ice cloud (the good canvas). Daytime only.", ir: "Live GOES-East infrared — colored = cold, high cloud tops.", radar: "Live NEXRAD radar — rain now." }[o];
  }));
  const markers = {};
  function renderMarkers() {
    state.results.forEach(r => {
      const lb = label(r.ev.score);
      const B = r.ev.bonus, T = r.ev.tri, ic = pinIcons(r);
      const bx = B.dog.p >= 22 ? `<em class="pb dog">◉</em>` : "";
      const html = `<div class="pin${T.on ? " tri" : ""}" style="--c:${lb.c}"><span>${r.ev.score}</span>${bx}${T.on ? `<em class="ptri" title="Trifecta">✦</em>` : ""}${ic.length ? `<div class="pwx">${ic.map(x => `<i class="${x.c}" title="${x.t}">${x.i}</i>`).join("")}</div>` : ""}</div>`;
      const icon = L.divIcon({ className: "pin-wrap", html, iconSize: [30, 30], iconAnchor: [15, 15] });
      if (markers[r.spot.id]) markers[r.spot.id].setIcon(icon);
      else markers[r.spot.id] = L.marker([r.spot.lat, r.spot.lng], { icon, riseOnHover: true }).addTo(map)
        .on("click", () => openDetail(r.spot.id))
        .bindTooltip("", { direction: "top", offset: [0, -16], className: "tip" });
      markers[r.spot.id].setTooltipContent(`<b>${r.spot.name}</b><br>${lb.t} · ${fmtTime(r.ev.tSet, r.tz)}${r.ev.bonus.bow.p >= BONUS_MIN ? `<br>🌈 ${r.ev.bonus.bow.name} ${r.ev.bonus.bow.p}%` : ""}${r.ev.bonus.dog.p >= BONUS_MIN ? `<br>◉ Sun dogs ${r.ev.bonus.dog.p}%` : ""}${r.ev.wx.items.map(w => `<br>${w.icon} ${w.name}${w.p ? " " + w.p + "%" : ""}`).join("")}${r.ev.tri.on ? `<br><b class="tt-tri">✦ TRIFECTA</b>` : ""}`);
      if (markers[r.spot.id].setZIndexOffset) markers[r.spot.id].setZIndexOffset(r.ev.tri.on ? 1000 : ic.length ? 200 : 0);
    });
  }

  // ---------- Compute ----------
  function compute() {
    const { S, W, E, AQ } = state.data;
    state.results = SPOTS.map((spot, i) => ({ spot, i, tz: S[i].timezone, ev: evaluate(spot, S[i], [W[i * 3], W[i * 3 + 1], W[i * 3 + 2]], E[i], state.day, AQ && AQ[i]) }));
  }

  // ---------- Render ----------
  function renderDays() {
    const S0 = state.data.S[0];
    $("#days").innerHTML = S0.daily.time.map((t, i) => {
      // best score that day
      const best = Math.max(...SPOTS.map((sp, k) => evaluate(sp, state.data.S[k], [state.data.W[k * 3], state.data.W[k * 3 + 1], state.data.W[k * 3 + 2]], state.data.E[k], i, state.data.AQ && state.data.AQ[k]).score));
      const lb = label(best);
      return `<button class="day ${i === state.day ? "on" : ""}" data-day="${i}"><span class="d1">${fmtDay(t + 43200, S0.timezone, i)}</span><span class="d2">${fmtDate(t + 43200, S0.timezone)}</span><span class="d3" style="--c:${lb.c}">best ${best}</span></button>`;
    }).join("");
    document.querySelectorAll(".day").forEach(b => b.addEventListener("click", () => { state.day = +b.dataset.day; update(); }));
  }
  function filtered() {
    const reg = REGIONS[state.region].states;
    let list = state.results.filter(r => !reg || reg.includes(r.spot.state));
    if (state.userLoc) list.forEach(r => r.mi = dist(state.userLoc, r.spot));
    list.sort((a, b) => b.ev.score - a.ev.score);
    return list;
  }
  function renderHero(list) {
    const b = list[0]; if (!b) return;
    const lb = label(b.ev.score), conf = confidence(state.day);
    $("#hero").innerHTML = `
      <div class="hero-k">Best ${state.day === 0 ? (RISE ? "this morning" : "tonight") : "on " + fmtDay(b.ev.tSet, b.tz, state.day)} · ${REGIONS[state.region].name}</div>
      <div class="hero-row"><div><div class="hero-name">${b.spot.name}</div><div class="hero-sub">${b.spot.state} · ${EV} ${fmtTime(b.ev.tSet, b.tz)}</div></div>
      <div class="ring" style="--p:${b.ev.score};--c:${lb.c}"><b>${b.ev.score}</b><i>${lb.t}</i></div></div>
      <div class="hero-why">${b.ev.reasons[0]} Best minute ~${fmtTime(b.ev.timing.peak, b.tz)}.</div><div class="conf ${conf.c}">${conf.t}</div>`;
    $("#hero").onclick = () => openDetail(b.spot.id);
  }
  function renderList(list) {
    $("#list").innerHTML = list.map((r, k) => {
      const lb = label(r.ev.score);
      const B = r.ev.bonus, btag = [B.bow, B.dog].filter(b => b.p >= BONUS_MIN).map(b => `<span class="tag bonus ${b.id} ${bonusCls(b.p)}">${b.icon} ${b.name} ${b.p}%</span>`);
      if (r.ev.tri.on) btag.unshift(`<span class="tag tri">✦ Trifecta</span>`);
      r.ev.wx.items.slice(0, 2).forEach(w => btag.push(wxChip(w)));
      const tags = btag.concat(r.ev.badges.filter(b => b.p >= 22 && b.id !== "bow" && b.id !== "dog").sort((a, b) => b.p - a.p).slice(0, Math.max(0, 4 - btag.length)).map(b => `<span class="tag ${b.id}">${b.icon} ${b.name.toLowerCase()} ${likely(b.p).toLowerCase()}</span>`));
      return `<li class="item" data-id="${r.spot.id}" style="--c:${lb.c};animation-delay:${k * 18}ms">
        <div class="rank">${k + 1}</div>
        <div class="meta"><div class="nm">${r.spot.name} <span class="st">${r.spot.state}</span></div>
        <div class="sub">${fmtTime(r.ev.tSet, r.tz)} · ${r.spot.type}${r.mi != null ? ` · ${Math.round(r.mi)} mi` : ""}</div>
        <div class="bar"><i style="width:${r.ev.score}%"></i></div>${tags.length ? `<div class="tags">${tags.join("")}</div>` : ""}</div>
        <div class="sc"><b>${r.ev.score}</b><span>${lb.t}</span></div></li>`;
    }).join("");
    document.querySelectorAll(".item").forEach(li => {
      li.addEventListener("click", () => openDetail(li.dataset.id));
      li.addEventListener("mouseenter", () => markers[li.dataset.id] && markers[li.dataset.id].openTooltip());
      li.addEventListener("mouseleave", () => markers[li.dataset.id] && markers[li.dataset.id].closeTooltip());
    });
  }
  function update() {
    compute(); renderDays(); const list = filtered(); renderHero(list); renderBonus(list); renderList(list); renderMarkers();
    if (state.spot) openDetail(state.spot, true);
  }

  // ---------- Detail ----------
  function barRow(lbl, v) { v = Math.round(v ?? 0); return `<div class="brow"><span>${lbl}</span><div class="btrack"><i style="width:${v}%"></i></div><b>${v}%</b></div>`; }
  function timeline(r) {
    const { S, W } = state.data, h = S[r.i].hourly, w = W[r.i * 3].hourly, t0 = r.ev.tSet - (RISE ? 1 : 4) * 3600, t1 = r.ev.tSet + (RISE ? 4 : 1) * 3600;
    const idx = h.time.map((t, i) => [t, i]).filter(([t]) => t >= t0 - 1800 && t <= t1 + 1800);
    const cw = 100 / idx.length;
    const cols = idx.map(([t, i]) => {
      const lo = h.cloud_cover_low[i], md = h.cloud_cover_mid[i], hi = h.cloud_cover_high[i], wl = w.cloud_cover_low[i];
      const isSet = Math.abs(t - r.ev.tSet) < 1800;
      return `<div class="tcol ${isSet ? "set" : ""}" style="width:${cw}%">
        <div class="tstack"><i class="hi" style="opacity:${hi / 100}"></i><i class="md" style="opacity:${md / 100}"></i><i class="lo" style="opacity:${lo / 100}"></i><i class="wl" style="opacity:${wl / 100}" title="${DIRW} horizon low cloud"></i></div>
        <div class="tlab">${new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: r.tz }).format(new Date(t * 1000)).replace(" ", "")}</div></div>`;
    }).join("");
    return `<div class="timeline">${cols}</div><div class="tlegend"><span><i class="hi"></i>High</span><span><i class="md"></i>Mid</span><span><i class="lo"></i>Low overhead</span><span><i class="wl"></i>Low, 40 km toward ${EV}</span></div>`;
  }
  // Sun elevation curve (§1.1) with timing markers
  function sunChart(r) {
    const T = r.ev.timing, sp = r.spot, [t0, t1] = RISE ? [(T.civilEnd || T.sunset - 1800) - 300, (T.golden || T.sunset + 3600) + 1200] : [(T.golden || T.sunset - 3600) - 1200, (T.civilEnd || T.sunset + 1800) + 300];
    const W = 520, H = 130, eMin = -8, eMax = 10;
    const X = t => (t - t0) / (t1 - t0) * W, Y = el => H - (el - eMin) / (eMax - eMin) * H;
    let d = ""; for (let t = t0; t <= t1; t += 120) { const el = sunPos(t, sp.lat, sp.lng).elev; d += (d ? "L" : "M") + X(t).toFixed(1) + "," + Y(Math.max(eMin, Math.min(eMax, el))).toFixed(1); }
    const mk = (t, c, lbl, up) => t ? `<line x1="${X(t)}" x2="${X(t)}" y1="0" y2="${H}" stroke="${c}" stroke-dasharray="3 3" opacity=".7"/><text x="${X(t) + 3}" y="${up ? 12 : H - 4}" fill="${c}" font-size="10">${lbl}</text>` : "";
    return `<svg class="sunchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347" stop-opacity=".25"/><stop offset=".55" stop-color="#ff4f9a" stop-opacity=".15"/><stop offset="1" stop-color="#3b2a6b" stop-opacity=".3"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#skyg)"/>
      <rect y="${Y(6)}" width="${W}" height="${Y(0) - Y(6)}" fill="#ffb347" opacity=".08"/>
      <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="#fff" opacity=".35"/>
      <line x1="0" x2="${W}" y1="${Y(-6)}" y2="${Y(-6)}" stroke="#7b5cff" opacity=".5" stroke-dasharray="2 4"/>
      <path d="${d}" fill="none" stroke="#ffd29a" stroke-width="2.5"/>
      ${mk(T.golden, "#ffd29a", RISE ? "golden hour ends" : "golden hour", true)}${mk(T.sunset, "#ff7a3d", EV, false)}${mk(T.peak, "#ff4f9a", "peak", true)}${mk(T.glowEnd, "#c9b8ff", RISE ? "first color" : "glow ends", false)}
      <text x="4" y="${Y(0) - 3}" fill="#fff" opacity=".6" font-size="9">0° horizon</text><text x="4" y="${Y(-6) - 3}" fill="#b5a9ff" font-size="9">−6° civil twilight</text>
    </svg>`;
  }
  // ---------- Predicted-sunset stage + time scrubber ----------
  function scrubRange(T) { if (RISE) return [(T.civilEnd || T.sunset - 1800) - 600, (T.golden || T.sunset + 3600) + 600]; const t0 = (T.golden || T.sunset - 3600) - 600, t1 = (T.civilEnd || T.sunset + 1800) + 600; return [t0, t1]; }
  function stage(r) {
    const sp = r.spot, ev = r.ev, T = ev.timing, s = ev.s, lb = label(ev.score), [t0, t1] = scrubRange(T);
    const pct = t => ((t - t0) / (t1 - t0) * 100).toFixed(2);
    const marks = (RISE ? [["golden", T.golden, "Golden hour ends", "Golden"], ["sunset", T.sunset, "Sunrise", "Sunrise"], ["peak", T.peak, "Best", "Best"], ["glow", T.glowEnd, "First color", "1st color"], ["civil", T.civilEnd, "Civil dawn", "Dawn"]] : [["golden", T.golden, "Golden hour", "Golden"], ["sunset", T.sunset, "Sunset", "Sunset"], ["peak", T.peak, "Best", "Best"], ["glow", T.glowEnd, "Glow ends", "Glow end"], ["civil", T.civilEnd, "Twilight ends", "Dusk"]]).filter(m => m[1]).sort((a, b) => a[1] - b[1]);
    // merge markers that would overlap on the track (e.g. best minute ≈ glow ends)
    const merged = []; for (const m of marks) { const prev = merged[merged.length - 1]; if (prev && (m[1] - prev[1]) / (t1 - t0) < 0.07) { prev[2] += " · " + m[2]; prev[3] += "·" + m[3]; } else merged.push([...m]); }
    marks.length = 0; marks.push(...merged);
    const hazeTxt = ev.clean > 0.85 ? "Crisp air" : ev.clean > 0.65 ? "Light haze" : ev.clean > 0.45 ? "Hazy" : "Heavy haze";
    const types = Object.fromEntries(ev.clouds.map(c => [c.level.toLowerCase().split(" ")[0], c.type.split(" — ")[0]]));
    const P = provenance(r), nct = noaaCloudTypes(r);
    if (nct) nct.forEach(c => types[c.level.toLowerCase()] = c.type.replace(/ \(.*/, "") + (c.type.includes("GOES") ? " ✓" : ""));
    const chip = (k, v, sub, p) => `<div class="rc"><span>${k} ${p ? tag(p) : ""}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    // track colors: day gold → sunset orange → peak rose → glow violet → night
    const tr = RISE ? `linear-gradient(90deg,#0b0a1c 0%,#1d1b44 ${pct(T.civilEnd || t0)}%,#7b5cff ${pct(T.glowEnd || T.peak - 900)}%,#ff4f9a ${pct(T.peak)}%,#ff8a3d ${pct(T.sunset)}%,#ffd08a ${pct(T.golden || t1)}%,#8fb3d9 100%)` : `linear-gradient(90deg,#8fb3d9 0%,#ffd08a ${pct(T.golden || t0)}%,#ff8a3d ${pct(T.sunset)}%,#ff4f9a ${pct(T.peak)}%,#7b5cff ${pct(T.glowEnd || T.peak + 900)}%,#1d1b44 ${pct(T.civilEnd || t1)}%,#0b0a1c 100%)`;
    return `
      <section class="stage" style="--c:${lb.c}">
        <canvas id="pv" aria-label="Illustrated forecast of the ${EV} at ${sp.name}"></canvas>
        <img id="pv-ph0" class="pv-photo" alt=""><img id="pv-ph1" class="pv-photo" alt="">
        <div class="stage-top">
          <div><div class="d-kick">${sp.type} · ${sp.state}${r.mi != null ? " · " + Math.round(r.mi) + " mi away" : ""} · ${fmtDay(ev.tSet, r.tz, state.day)} ${fmtDate(ev.tSet, r.tz)}</div><h2>${sp.name}</h2></div>
          <div class="stage-score"><b>${ev.score}</b><i>${lb.t}</i></div>
        </div>
        <div id="pv-gen" class="pv-gen" hidden></div>
        <div class="stage-bottom">
          <div class="stage-now"><b id="pv-time"></b><span id="pv-phase"></span><small id="pv-elev"></small></div>
          <div class="stage-foot">
            <div class="stage-badge"><span id="pv-badge">Illustrated forecast · not a photo</span><button id="pv-mode" class="pv-mode" hidden>AI finish: on</button></div>
            <div class="stage-dir">Facing ${compass(ev.sunsetAz)} ${Math.round(ev.sunsetAz)}°</div>
          </div>
        </div>
      </section>
      <div class="scrub" style="--track:${tr}">
        <div class="scrub-marks">${marks.map((m, k) => `<button data-t="${m[1]}" style="left:${pct(m[1])}%" class="mk ${m[0]} ${k % 2 ? "alt" : ""}"><i></i><span class="lf">${m[2]}</span><span class="ls">${m[3]}</span><em>${fmtTime(m[1], r.tz).replace(/ [A-Z]{2,4}$/, "")}</em></button>`).join("")}</div>
        <input id="scrub" type="range" min="${t0}" max="${t1}" step="20" value="${T.peak}" aria-label="Time of ${RISE ? "morning" : "evening"}">
        <div class="scrub-row"><button id="pv-play" class="play">${PLAY}</button><span id="pv-what" class="pv-what"></span></div>
      </div>
      <div class="readout">
        ${chip("High", Math.round(s.high) + "%", types.high || "", P.clouds)}
        ${chip("Mid", Math.round(s.mid) + "%", types.mid || "", P.clouds)}
        ${chip("Low", Math.round(s.low) + "%", types.low || "", P.clouds)}
        ${chip(DIRW + " gap", Math.round((1 - ev.slotBlock) * 100) + "% open", ev.slotBlock < 0.25 ? "light gets in" : ev.slotBlock < 0.55 ? "partly blocked" : "mostly blocked", P.path)}
        ${chip("Air", hazeTxt, s.aod != null ? "AOD " + s.aod.toFixed(2) : "RH " + Math.round(ev.rhLow) + "%", P.aod)}
      </div>
      <div class="fine pv-fine">This is an illustrated preview generated from this spot's forecast, not a photo. Cloud cover by layer comes from NOAA HRRR (with the low-cloud gap along the ${EV} line), haze from NOAA GOES-19 AOD / CAMS, and the lighting follows the actual sun position. Drag the slider or hit Play to watch the colors change through ${RISE ? "blue hour, first color, sunrise and golden hour" : "golden hour, sunset, afterglow and blue hour"}. Weather is drawn only when the forecast calls for it during the ${EV} window: rain (slanted by the wind), ⚡ storm cell and lightning (odds ≥ 25%), whitecaps (wind ≥ 15 mph), fog and snow. Rainbows form opposite the sun — behind you — so when rainbow odds are ≥ 10% a 🌈 “behind you” panel appears during the forecast rainbow window.</div>
      ${noaaPanel(r)}`;
  }

  function hrrrAt(id, tSet) {
    const H = state.noaa && state.noaa.hrrr && state.noaa.hrrr.hours; if (!H) return null;
    const ts = Object.keys(H).map(Number).sort((a, b) => a - b), lo = ts.filter(t => t <= tSet).pop(), hi = ts.find(t => t > tSet);
    if (lo == null || hi == null || hi - lo > 3600 || !H[lo][id] || !H[hi][id]) return null;
    const f = (tSet - lo) / 3600, a = H[lo][id], b = H[hi][id], o = {};
    for (const k in a) o[k] = a[k] == null ? b[k] : b[k] == null ? a[k] : a[k] + (b[k] - a[k]) * f;
    return o;
  }
  function noaaPanel(r) {
    const N = state.noaa, sp = r.spot, ev = r.ev, tSet = ev.tSet;
    if (!N) return `<h3>NOAA data</h3><div class="fine"><span class="src fb">Offline</span> The on-box NOAA fetcher hasn't produced data/noaa.json — scores use the NOAA HRRR/GFS mirror only.</div>`;
    const f = (v, d = 0, u = "") => v == null || isNaN(v) ? "—" : (+v).toFixed(d) + u;
    const pct = v => v == null ? "—" : Math.round(v) + "%";
    const cyc = N.hrrr ? new Date(N.hrrr.cycle_utc).toISOString().slice(11, 13) + "Z" : "";
    const hs = hrrrAt(sp.id, tSet), hp = [40, 120, 200].map(km => RISE ? null : hrrrAt(`${sp.id}@${km}`, tSet));
    const hrrrCard = hs ? `<div class="ncard"><div class="nh"><b>HRRR at ${EV}</b><span class="src model">NOAA model</span></div>
      <div class="ngrid"><div><span>Low / Mid / High</span><b>${pct(hs.low)} / ${pct(hs.mid)} / ${pct(hs.high)}</b></div><div><span>Total cloud</span><b>${pct(hs.total)}</b></div>
      <div><span>Cloud base</span><b>${hs.cbase_m != null && hs.cbase_m < 20000 ? f(hs.cbase_m * 3.281 / 1000, 1, "k ft") : "—"}</b></div><div><span>Visibility</span><b>${f(hs.vis_m / 1609, 0, " mi")}</b></div>
      <div><span>RH 2 m</span><b>${pct(hs.rh2m)}</b></div><div><span>Rain rate</span><b>${f(hs.prate_mmh, 1, " mm/h")}</b></div>
      <div><span>Smoke near surface</span><b>${f(hs.smoke_sfc_ugm3, 1, " µg/m³")}</b></div><div><span>Smoke column</span><b>${f(hs.smoke_col_mgm2, 1, " mg/m²")}</b></div>
      <div><span>Smoke AOD (HRRR-Smoke)</span><b>${f(hs.aot, 3)}</b></div>
      <div><span>Low cloud toward sun</span><b>${hp.map(x => x ? pct(x.low) : "—").join(" · ")}</b></div></div>
      <div class="fine">HRRR ${cyc} run, 3 km, read directly from NOAA's grib2 on AWS Open Data and interpolated to ${fmtTime(tSet, r.tz)}. ${RISE ? "Sunrise path (east) clouds come from the NOAA HRRR/GFS mirror." : "Path = 40 / 120 / 200 km toward the sunset."}</div></div>`
      : `<div class="ncard"><div class="nh"><b>HRRR at ${EV}</b><span class="src model">NOAA model</span></div><div class="fine">${state.day > 1 ? "Beyond HRRR's 48-h range — this day uses NOAA GFS (via Open-Meteo mirror)." : "Direct HRRR hours not available for this sunset — using NOAA HRRR via Open-Meteo mirror."}</div></div>`;
    const G = N.goes, gp = G && G.points[sp.id], gpath = G && !RISE ? [40, 120, 200].map(km => G.points[`${sp.id}@${km}`] || {}) : [];
    const phase = g => { const p = g && g.phase; if (!p) return "clear"; const e = Object.entries(p).sort((a, b) => b[1] - a[1])[0]; return `${e[0]} ${Math.round(e[1] * 100)}%`; };
    const warn = [];
    if (G && state.day === 0) {
      const lowW = gpath.filter(g => g.low_stratus_fog).length;
      if (lowW && hp.every(x => !x || x.low < 25)) warn.push(`GOES-19 currently sees low liquid cloud/fog along the ${EV} line (${lowW}/3 points) that HRRR clears by ${EV} — watch it.`);
      if (gp && gp.obs_high > 0.5 && (gp.phase || {}).ice > 0.5) warn.push(`GOES-19 confirms ice cloud overhead now (tops ${f(gp.cth_km_med, 1)} km) — real cirrus canvas.`);
    }
    const goesCard = G && gp ? `<div class="ncard"><div class="nh"><b>GOES-19 observed now</b><span class="src obs">NOAA obs</span></div>
      <table class="ntab"><tr><th></th><th>Cloud</th><th>Top</th><th>Phase</th><th>AOD</th></tr>
      ${[["Here", gp], ...gpath.map((g, k) => [`${[40, 120, 200][k]} km ${DIRW[0]}`, g])].map(([n, g]) => `<tr><td>${n}</td><td>${g.cloud_frac != null ? Math.round(g.cloud_frac * 100) + "%" : "—"}</td><td>${f(g.cth_km_med, 1, " km")}</td><td>${phase(g)}</td><td>${f(g.aod, 2)}</td></tr>`).join("")}</table>
      <div class="fine">ABI L2 CONUS products from NOAA Open Data (s3://noaa-goes19): clear-sky mask (ACM), cloud-top height (ACHA), cloud-top phase (ACTP), aerosol optical depth (AOD; daytime, clear pixels only). Scan ${fmtClock(G.products.ACM ? G.products.ACM.scan_utc : G.products.CTH.scan_utc)}. ${state.day === 0 ? "Tonight's haze score uses this AOD." : "Current observation — most useful for tonight."}</div></div>` : "";
    const M = N.metar && N.metar[sp.id];
    const metarCard = M ? `<div class="ncard"><div class="nh"><b>Surface obs · ${M.station}</b><span class="src obs">NOAA obs</span></div>
      <div class="ngrid"><div><span>Station</span><b>${M.name || M.station} · ${Math.round(M.dist_km * 0.621)} mi</b></div><div><span>Observed</span><b>${fmtClock(M.obs_utc)}</b></div>
      <div><span>Visibility</span><b>${M.vis_mi != null ? M.vis_mi + (M.vis_mi >= 10 ? "+" : "") + " mi" : "—"}</b></div><div><span>Weather</span><b>${M.wx || "none"}</b></div>
      <div><span>Cloud bases</span><b>${(M.clouds || []).map(c => `${c.cover}${c.base != null ? " " + (c.base / 1000).toFixed(1) + "k ft" : ""}`).join(", ") || "clear"}</b></div><div><span>Temp / dew</span><b>${f(M.temp_c * 9 / 5 + 32, 0, "°")} / ${f(M.dewp_c * 9 / 5 + 32, 0, "°F")}</b></div></div>
      <div class="fine mono">${M.raw}</div></div>` : `<div class="ncard"><div class="nh"><b>Surface obs</b><span class="src obs">NOAA obs</span></div><div class="fine">No METAR station within ~30 mi of this spot.</div></div>`;
    const P = provenance(r);
    const prov = [[`Cloud layers & ${dirw}ern gap`, P.clouds], ["Visibility / humidity", P.vis], ["Haze (AOD)", P.aod], ["PM2.5", P.pm], ["Cloud types", P.types], ["Front / pressure trend", P.front], ["Sun position & times", P.sun]];
    return `<h3>NOAA data <small>what drives this forecast</small></h3>
      ${warn.length ? `<div class="nwarn">${warn.map(w => `<div>🛰 ${w}</div>`).join("")}</div>` : ""}
      <div class="ncards">${hrrrCard}${goesCard}${metarCard}</div>
      <div class="prov">${prov.map(([k, p]) => `<div><span>${k}</span>${tag(p)}<small>${p.t}</small></div>`).join("")}</div>`;
  }
  function wireStage(r, tKeep) {
    const cv = $("#pv"), sl = $("#scrub"), sp = r.spot, ev = r.ev; if (!cv || !sl) return;
    if (tKeep) sl.value = tKeep;
    let raf = 0, playing = 0;
    const word = l => l.lit < 0.08 ? "in shadow" : (l.c[1] > 200 ? "lit gold-white" : l.c[1] > 150 ? "lit gold" : l.c[1] > 100 ? "lit orange" : "lit pink-red");
    const render = () => {
      raf = 0; const t = +sl.value; state.pvT = t; state.pvSpot = sp.id;
      const o = PhotoStage.draw(cv, sp, ev, t, { lq: dragging });
      showPhotos(t);
      if (dragging && o.mode === "live") { clearTimeout(hqT); hqT = setTimeout(() => { dragging = false; queue(); }, 160); }
      $("#pv-time").textContent = fmtTime(t, r.tz);
      $("#pv-phase").textContent = phaseName(o.phase);
      $("#pv-elev").textContent = `sun ${o.elev >= 0 ? "+" : "−"}${Math.abs(o.elev).toFixed(1)}°`;
      const parts = [["high", ev.s.high, "Cirrus"], ["mid", ev.s.mid, "Mid cloud"], ["low", ev.s.low, "Low cloud"]].filter(x => x[1] >= 10).map(x => `${x[2]} ${word(o.lit[x[0]])}`);
      $("#pv-what").textContent = parts.length ? parts.join(" · ") : (o.elev > 0 ? "Clear sky: clean gradient, little canvas" : "Clear sky: horizon band fading");
      document.querySelectorAll(".scrub .mk").forEach(b => b.classList.toggle("on", Math.abs(+b.dataset.t - t) < 90));
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(render); };
    let dragging = false, hqT = 0, photoOn = true;
    const ph = [$("#pv-ph0"), $("#pv-ph1")], badge = $("#pv-badge"), modeBtn = $("#pv-mode"), gen = $("#pv-gen");
    const [t0, t1] = scrubRange(ev.timing);
    function showPhotos(t) {
      const set = PhotoStage.photoSet(sp, ev), mix = photoOn ? PhotoStage.photoMix(set, t) : null;
      ph.forEach((im, k) => { const m = mix && mix[k]; if (m) { if (im.getAttribute("src") !== m[0]) im.src = m[0]; im.style.opacity = m[1]; } else im.style.opacity = 0; });
      if (badge) badge.textContent = mix ? "AI photo finish · not a real photo" : PhotoStage.live() ? "Forecast render · not a photo" : "Illustrated forecast · not a photo";
    }
    const status = set => {
      if (!gen) return;
      const n = set.frames.length, tot = PhotoStage.keyTimes(sp, ev, t0, t1, ev.timing.peak).length;
      modeBtn.hidden = !n;
      gen.hidden = set.done || !set.busy; gen.textContent = `Photo finish ${n}/${tot}…`;
      queue();
    };
    if (modeBtn) modeBtn.onclick = () => { photoOn = !photoOn; modeBtn.textContent = "AI finish: " + (photoOn ? "on" : "off"); queue(); };
    if (PhotoStage.live()) {
      const box = cv.getBoundingClientRect(), aspect = box.width / Math.max(1, box.height) || 1.3;
      PhotoStage.apiOK().then(ok => { if (!ok || state.spot !== sp.id) return; if (gen) { gen.hidden = false; gen.textContent = "Photo finish…"; }
        PhotoStage.ensurePhotos(sp, ev, t0, t1, ev.timing.peak, aspect, s2 => { if (state.spot === sp.id && document.body.contains(cv)) status(s2); }); });
    }
    sl.addEventListener("input", () => { stop(); dragging = true; queue(); });
    document.querySelectorAll(".scrub .mk").forEach(b => b.addEventListener("click", () => { stop(); sl.value = b.dataset.t; queue(); }));
    const stop = () => { if (playing) { cancelAnimationFrame(playing); playing = 0; $("#pv-play").textContent = PLAY; } };
    $("#pv-play").onclick = () => {
      if (playing) return stop();
      const t0 = +sl.min, t1 = +sl.max, dur = 9000; let start = null;
      if (+sl.value >= t1 - 60) sl.value = t0;
      const from = +sl.value;
      $("#pv-play").textContent = "❚❚ Pause";
      const step = ts => { if (start == null) start = ts; const f = Math.min(1, (ts - start) / (dur * (t1 - from) / (t1 - t0))); sl.value = from + (t1 - from) * f; dragging = f < 1; render(); playing = f < 1 ? requestAnimationFrame(step) : (stop(), 0); };
      playing = requestAnimationFrame(step);
    };
    render();
    if (!window._pvResize) { window._pvResize = true; window.addEventListener("resize", () => { const s2 = $("#scrub"); if (s2 && state.spot) s2.dispatchEvent(new Event("input")); }); }
  }
  async function openDetail(id, keepScroll) {
    state.spot = id;
    const r = state.results.find(x => x.spot.id === id), sp = r.spot, ev = r.ev, s = ev.s, lb = label(ev.score), conf = confidence(state.day), T = ev.timing;
    const el = $("#detail-body"), scroll = el.scrollTop;
    const tw = t => t ? fmtTime(t, r.tz) : "—";
    const f = (v, d = 0, u = "") => v == null || isNaN(v) ? "—" : v.toFixed(d) + u;
    const domTxt = { high: "cirrus-level (~9 km)", mid: "mid-level (~4 km)", low: "low (~1 km)", clear: "clear sky" }[T.dom];
    const badges = ev.badges.slice().sort((a, b) => b.p - a.p);
    el.innerHTML = `
      ${stage(r)}
      <div class="d-head"><p class="d-note">${sp.note}</p></div>
      <div class="d-score">
        <div class="ring big" style="--p:${ev.score};--c:${lb.c}"><b>${ev.score}</b><i>${lb.t}</i></div>
        <div><div class="d-time">${Ev} <b>${fmtTime(ev.tSet, r.tz)}</b></div>
        <div class="d-sub">Sky score <b>${ev.sky}</b> · Site fit <b>${ev.site}</b></div>
        <div class="conf ${conf.c}">${conf.t}</div></div>
      </div>
      ${ev.tri.on || ev.tri.n >= 2 ? trifectaCard(r) : ""}
      <h3>🌦️ Weather during ${EV} <small>${hm(ev.wx.win.start, r.tz)}–${hm(ev.wx.win.end, r.tz)}</small></h3>
      <div class="wxd">${ev.wx.items.length ? ev.wx.items.map(w => `<div class="wxi ${w.id}"><b>${w.icon}</b><div><div class="wn">${w.name}${w.p ? ` <em>${w.p}%</em>` : ""}</div><div class="wt">${w.txt}${w.id === "bolt" && w.win ? ` Strikes most likely ${hm(w.win.start, r.tz)}–${hm(w.win.end, r.tz)}.` : ""}</div></div></div>`).join("") : `<div class="wxi none"><b>✓</b><div><div class="wn">No rain, wind, lightning or fog</div><div class="wt">Lightning ${ev.wx.bolt.p}% · wind ${ev.wx.wind.mph} mph (gusts ${ev.wx.wind.gust}) · rain chance ${ev.wx.rain.pp}%</div></div></div>`}</div>
      <h3>✨ Special bonus <small>rainbow & sun-dog odds for this spot</small></h3>
      <div class="bonus-d">${bonusCard(ev.bonus.bow, r, { kicker: ev.bonus.bow.red ? "Red rainbow (low sun)" : "Rainbow odds" })}${bonusCard(ev.bonus.dog, r, { kicker: "Sun-dog odds" })}</div>
      ${ev.gates.length ? `<div class="gates">${ev.gates.map(g => `<div>⚠ ${g}</div>`).join("")}</div>` : ""}
      <div class="timing">
        ${RISE ? `<div><span>Civil dawn</span><b>${tw(T.civilEnd)}</b></div>
        <div><span>First color</span><b>${tw(T.glowEnd)}</b></div>
        <div class="pk"><span>Best minute</span><b>${tw(T.peak)}</b></div>
        <div><span>Sunrise</span><b>${tw(T.sunset)}</b></div>
        <div><span>Golden hour ends</span><b>${tw(T.golden)}</b></div>` : `<div><span>Golden hour</span><b>${tw(T.golden)}</b></div>
        <div><span>Sunset</span><b>${tw(T.sunset)}</b></div>
        <div class="pk"><span>Best minute</span><b>${tw(T.peak)}</b></div>
        <div><span>Afterglow ends</span><b>${tw(T.glowEnd)}</b></div>
        <div><span>Civil twilight</span><b>${tw(T.civilEnd)}</b></div>`}
      </div>
      ${sunChart(r)}
      <div class="fine">Peak timing from the dominant cloud height (${domTxt}): ${RISE ? "high cloud lights up ~15–20 min before sunrise, low cloud only ~4–8." : "high cloud stays sunlit ~15–20 min after sunset, low cloud only ~4–8."} Twilight lasts ~${T.twilightMin ?? "—"} min here today.</div>
      <h3>Sky phenomena <small>separate from the color score</small></h3>
      <div class="wow">${badges.map(b => `<div class="wb ${b.p >= 40 ? "hi" : b.p >= 22 ? "md" : b.p >= 10 ? "lo" : "no"}"><div class="wi">${b.icon}</div><div class="wn">${b.name}</div><div class="wl">${likely(b.p)}<small> · ${b.p}</small></div><div class="wt">${b.why}${b.p >= 10 && b.t ? ` <em>~${tw(b.t)}</em>` : ""}</div></div>`).join("")}</div>
      <h3>Why this score</h3>
      <ul class="why">${ev.reasons.map(x => `<li>${x}</li>`).join("")}</ul>
      <div class="comps">${ev.comp.map(c => `<div class="cp"><span>${c.k}</span><small>${c.w}%</small><div class="btrack"><i style="width:${Math.round(c.q * 100)}%"></i></div><b>${Math.round(c.q * c.w)}</b></div>`).join("")}
      <div class="fine">Weighted sum ×${ev.season.toFixed(2)} season prior, then gates. Overall = sky × site fit. All weights are starting estimates (Sunset Metric Bible v1 §13).</div></div>
      <h3>${DIRW}ern gap ${tag(provenance(r).path)} <small>along the ${EV} line, ${compass(ev.sunsetAz)}</small></h3>
      <div class="pathviz">${ev.path.map(p => `<div class="pv"><div class="pvk">${p.km} km</div>${barRow("Low", p.low)}${barRow("Mid", p.mid)}${barRow("High", p.high)}</div>`).join("")}</div>
      <div class="fine">Clouds 0–200 km toward the sun decide whether light reaches the sky above you. Blocked: <b>${Math.round(ev.slotBlock * 100)}%</b> (low + ½ mid, weighted toward nearby).</div>
      <h3>Clouds overhead at ${EV} ${tag(provenance(r).clouds)}</h3>
      <div>${barRow("High", s.high)}${barRow("Mid", s.mid)}${barRow("Low", s.low)}${barRow("Total", s.total)}</div>
      <div class="ctypes">${(noaaCloudTypes(r) || ev.clouds).map(c => `<div class="ct"><span>${c.level}</span><b>${c.type}</b></div>`).join("")}<div class="fine">Cloud types are inferred from layer cover, instability (CAPE), visibility and weather code — the model doesn't output cloud genus. ${noaaCloudTypes(r) ? "Tonight they're checked against GOES-19 observed cloud phase and top height." : ""} ${tag(provenance(r).types)}</div></div>
      <h3>Cloud timeline</h3>${timeline(r)}
      <h3>Air clarity & moisture ${tag(provenance(r).aod)}</h3>
      <div class="grid">
        <div><span>Aerosol optical depth</span><b>${f(s.aod, 2)}</b></div>
        <div><span>PM2.5 (surface)</span><b>${f(s.pm25, 0, " µg/m³")}</b></div>
        <div><span>Dust</span><b>${f(s.dust, 0, " µg/m³")}</b></div>
        <div><span>Visibility</span><b>${s.vis != null ? (s.vis / 1609).toFixed(s.vis < 16000 ? 1 : 0) + " mi" : "—"}</b></div>
        <div><span>RH surface</span><b>${f(s.rh, 0, "%")}</b></div>
        <div><span>RH 850 hPa (~1.5 km)</span><b>${f(s.rh850, 0, "%")}</b></div>
        <div><span>RH 300 hPa (cirrus level)</span><b>${f(s.rh300, 0, "%")}</b></div>
        <div><span>Dew-point spread</span><b>${f(ev.dewDep, 0, "°F")}</b></div>
        <div><span>Clean-air index</span><b>${Math.round(ev.clean * 100)}/100</b></div>
      </div>
      <h3>Fronts & pressure ${tag(provenance(r).front)}</h3>
      <div class="grid">
        <div><span>Pressure</span><b>${f(s.pres, 0, " hPa")}</b></div>
        <div><span>Δ 6 h</span><b>${ev.dP6 >= 0 ? "+" : ""}${f(ev.dP6, 1, " hPa")}</b></div>
        <div><span>Δ 24 h</span><b>${ev.dP24 >= 0 ? "+" : ""}${f(ev.dP24, 1, " hPa")}</b></div>
        <div><span>Dew pt Δ 24 h</span><b>${ev.dDew >= 0 ? "+" : ""}${f(ev.dDew, 0, "°F")}</b></div>
        <div><span>Front passage</span><b>${ev.fropaH != null ? "~" + ev.fropaH + " h ago" : "none in 36 h"}</b></div>
        <div><span>Rain last 24 h</span><b>${f(ev.priorRain, 1, " mm")}</b></div>
      </div>
      <div class="fine">Front timing is estimated from a ≥6 °F dew-point drop in the forecast series — a proxy, not an analyzed front.</div>
      <h3>Site & horizon</h3>
      <div class="grid">
        <div><span>Open view</span><b>${ev.siteInfo.arc[0]}°–${ev.siteInfo.arc[1]}°</b></div>
        <div><span>${Ev} azimuth</span><b>${Math.round(ev.sunsetAz)}° ${ev.siteInfo.inArc ? "✓" : "✗"}</b></div>
        <div><span>Horizon obstruction</span><b>~${ev.siteInfo.obst}°</b></div>
        <div><span>Water toward ${EV}</span><b>${ev.siteInfo.water ? "Yes" : "No"}</b></div>
        <div><span>Wind</span><b>${Math.round(s.wind)} mph ${compass(s.wdir)}</b></div>
        <div><span>Gusts</span><b>${Math.round(s.gust)} mph</b></div>
      </div>
      <div class="fine">${ev.siteInfo.surface}. View arcs and obstruction angles are hand-estimated per spot, not from a terrain model.</div>
      <h3>Satellite imagery read <small>pixel heuristic on GOES tiles — secondary to the NOAA L2 products above</small> <span class="src est">Estimate</span></h3>
      <div id="satread" class="satread"><div class="shimmer">Sampling GOES-East visible, cirrus & infrared around this spot…</div></div>
      <div class="actions"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${sp.lat},${sp.lng}">Directions ↗</a><button class="btn ghost" id="zoomto">Show on map</button></div>`;
    document.body.classList.add("detail-open");
    $("#detail").classList.add("open");
    el.scrollTop = keepScroll ? scroll : 0;
    wireStage(r, keepScroll && state.pvSpot === id ? state.pvT : null);
    $("#zoomto").onclick = () => { closeDetail(); map.flyTo([sp.lat, sp.lng], 10, { duration: 1.2 }); };
    const elevNow = sunPos(Date.now() / 1000, sp.lat, sp.lng).elev;
    const res = await Sat.readSpot(sp, sp.west, elevNow);
    if (state.spot !== id) return;
    const box = $("#satread"); if (!box) return;
    box.innerHTML = res.error ? `<p>${res.error}</p>` : `<ul>${res.text.map(t => `<li>${t}</li>`).join("")}</ul><div class="fine">Sampled from GOES-19 (GOES-East) ABI band 2 (visible, 0.64 µm), band 4 (cirrus, 1.37 µm) and band 13 (clean IR, 10.3 µm) at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(res.when)}. Pixel-color heuristics, not calibrated retrievals.</div>`;
  }
  function closeDetail() { state.spot = null; $("#detail").classList.remove("open"); document.body.classList.remove("detail-open"); }
  $("#detail-close").addEventListener("click", closeDetail);
  $("#scrim").addEventListener("click", closeDetail);
  document.addEventListener("keydown", e => e.key === "Escape" && closeDetail());

  // regions
  $("#regions").innerHTML = Object.entries(REGIONS).map(([k, v]) => `<button class="chip ${k === "all" ? "on" : ""}" data-r="${k}">${v.name}</button>`).join("");
  document.querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => {
    state.region = b.dataset.r; document.querySelectorAll("[data-r]").forEach(x => x.classList.toggle("on", x === b));
    const reg = REGIONS[state.region].states;
    const pts = SPOTS.filter(s => !reg || reg.includes(s.state)).map(s => [s.lat, s.lng]);
    map.flyToBounds(pts, { padding: [40, 40], duration: 1 });
    const list = filtered(); renderHero(list); renderBonus(list); renderList(list);
  }));
  $("#nearme").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    $("#nearme").textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(p => {
      state.userLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
      L.circleMarker([state.userLoc.lat, state.userLoc.lng], { radius: 7, color: "#fff", fillColor: "#5ab0ff", fillOpacity: 1, weight: 2 }).addTo(map);
      const near = SPOTS.map(s => [dist(state.userLoc, s), s]).sort((a, b) => a[0] - b[0]).slice(0, 5).map(x => [x[1].lat, x[1].lng]);
      map.flyToBounds([[state.userLoc.lat, state.userLoc.lng], ...near], { padding: [40, 40] });
      $("#nearme").textContent = "📍 Near me ✓"; const list = filtered(); renderList(list);
    }, () => { $("#nearme").textContent = "📍 Location blocked"; });
  });

  // regional satellite gallery
  function renderSatGallery(sector = "se", band = "GEOCOLOR") {
    const u = `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${sector}/${band}/600x600.jpg?_=${Math.floor(Date.now() / 300000)}`;
    $("#satimg").src = u;
    $("#satcap").textContent = `${sector === "ne" ? "Northeast" : "Southeast"} sector · ${band === "GEOCOLOR" ? "GeoColor (true-color by day, IR at night)" : band === "02" ? "Band 2 visible — texture & haze" : band === "04" ? "Band 4 cirrus (1.37 µm) — thin high cloud glows, low cloud stays dark" : "Band 13 infrared — cloud-top temperature"} · NOAA/NESDIS STAR, updates every ~5 min`;
    document.querySelectorAll("[data-sec]").forEach(b => b.classList.toggle("on", b.dataset.sec === sector));
    document.querySelectorAll("[data-band]").forEach(b => b.classList.toggle("on", b.dataset.band === band));
    state.sec = sector; state.band = band;
  }
  document.querySelectorAll("[data-sec]").forEach(b => b.addEventListener("click", () => renderSatGallery(b.dataset.sec, state.band)));
  document.querySelectorAll("[data-band]").forEach(b => b.addEventListener("click", () => renderSatGallery(state.sec, b.dataset.band)));
  renderSatGallery("se", "GEOCOLOR");

  // boot
  Promise.all([loadData(), loadNoaa()]).then(([d, N]) => {
    state.noaa = N; applyNoaa(d, N); state.data = d;
    if (RISE && d.S[0] && d.S[0].daily.sunrise[0] + 3600 < Date.now() / 1000) state.day = 1;   // this morning's sunrise is over → show tomorrow
    update();
    $("#loading").classList.add("done");
    $("#updated").innerHTML = "Forecast updated " + new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(d.at)) +
      (d.snapshot ? ` · <span class="src fb">Snapshot</span> live forecast busy — showing NOAA data saved ${fmtClock(new Date(d.at).toISOString())}` : d.stale ? ` · <span class="src fb">Cached</span> live forecast busy — using last download` : "") +
      (d.fcModel === "fallback" ? ` · <span class="src fb">Fallback</span> NOAA mirror unreachable — Open-Meteo best-match` : ` · <span class="src model">NOAA model</span> HRRR→GFS`) +
      (N ? ` · <span class="src obs">NOAA obs</span> GOES-19 L2 ${N.goes && N.goes.products.ACM ? fmtClock(N.goes.products.ACM.scan_utc) : "n/a"}${N.hrrr ? `, HRRR ${new Date(N.hrrr.cycle_utc).toISOString().slice(11, 13)}Z direct` : ""}${N.metar ? `, METAR` : ""}` : ` · <span class="src fb">NOAA direct feed offline</span>`);
  }).catch(err => {
    console.error(err);
    $("#loading").innerHTML = `<div class="err">Couldn't reach the forecast service (Open-Meteo). Check your connection and <a href="#" onclick="location.reload();return false">tap to retry</a>.</div>`;
  });
})();
