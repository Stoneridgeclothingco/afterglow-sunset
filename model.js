// Sunset quality / optics model. Pure functions, no DOM. All estimates are heuristics.
(function (g) {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  // piecewise-linear interpolation through [[x,y],...]
  function pw(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  }

  // NOAA-style solar position. t = unix seconds. Returns {elev, az} in degrees (az from north, clockwise).
  function sunPos(t, lat, lng) {
    const jd = t / 86400 + 2440587.5, T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * RAD);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD));
    const y = Math.tan(eps * RAD / 2) ** 2;
    const eqt = 4 * DEG * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    const minutesUTC = ((t % 86400) + 86400) % 86400 / 60;
    let tst = (minutesUTC + eqt + 4 * lng) % 1440; if (tst < 0) tst += 1440;
    let ha = tst / 4 - 180;
    const latR = lat * RAD, haR = ha * RAD;
    const cosZ = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(haR);
    const zen = Math.acos(clamp(cosZ, -1, 1));
    let az = Math.atan2(Math.sin(haR), Math.cos(haR) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)) * DEG + 180;
    return { elev: 90 - zen * DEG, az: (az + 360) % 360 };
  }

  // point at distance km along bearing deg
  function offset(lat, lng, bearing, km) {
    const R = 6371, d = km / R, b = bearing * RAD, p1 = lat * RAD, l1 = lng * RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: +(p2 * DEG).toFixed(4), lng: +(l2 * DEG).toFixed(4) };
  }

  // linear interpolation of an hourly series at unix time t
  function at(h, key, t) {
    const T = h.time, v = h[key]; if (!v) return null;
    let i = Math.floor((t - T[0]) / 3600);
    if (i < 0) i = 0; if (i >= T.length - 1) return v[T.length - 1];
    const f = (t - T[i]) / 3600, a = v[i], b = v[i + 1];
    if (a == null) return b; if (b == null) return a;
    return a + (b - a) * f;
  }
  const atCode = (h, t) => { const T = h.time; const i = clamp(Math.round((t - T[0]) / 3600), 0, T.length - 1); return h.weather_code ? h.weather_code[i] : null; };
  const sumRange = (h, key, t0, t1) => { let s = 0; for (let i = 0; i < h.time.length; i++) if (h.time[i] >= t0 && h.time[i] <= t1) s += h[key][i] || 0; return s; };
  const isShowery = c => (c >= 80 && c <= 82) || c >= 95;
  const isRain = c => (c >= 51 && c <= 67);

  function cloudTypes(s) {
    const out = [];
    if (s.high >= 5) out.push({ level: "High (≈20–40k ft)", type: s.high < 40 ? "Cirrus — thin, scattered wisps" : s.high < 75 ? "Cirrus / cirrocumulus" : "Cirrostratus — high ice sheet", cover: s.high });
    if (s.mid >= 5) out.push({ level: "Mid (≈7–20k ft)", type: s.mid < 50 ? "Altocumulus — patchy mackerel sky" : "Altostratus — grey mid-level layer", cover: s.mid });
    if (s.low >= 5) {
      let ty;
      if (isShowery(s.code) && s.code >= 95) ty = "Cumulonimbus — thunderstorms";
      else if (s.cape > 800 && s.low > 15) ty = "Towering cumulus";
      else if (s.vis != null && s.vis < 1500 && s.low > 70) ty = "Stratus / fog";
      else if (s.low > 70) ty = "Stratus / stratocumulus deck";
      else if (s.cape > 150) ty = "Fair-weather cumulus";
      else ty = "Stratocumulus";
      out.push({ level: "Low (< 6.5k ft)", type: ty, cover: s.low });
    }
    if (!out.length) out.push({ level: "All levels", type: "Clear sky", cover: 0 });
    return out;
  }

  // Find time (unix) when sun reaches elevation `el` after t0 (searching forward, 1-min steps)
  function timeAtElev(t0, lat, lng, el, maxMin = 90) {
    for (let m = 0; m <= maxMin; m++) { if (sunPos(t0 + m * 60, lat, lng).elev <= el) return t0 + m * 60; }
    return null;
  }
  function timeBeforeAtElev(t0, lat, lng, el, maxMin = 240) {
    for (let m = 0; m <= maxMin; m++) { if (sunPos(t0 - m * 60, lat, lng).elev >= el) return t0 - m * 60; }
    return null;
  }
  // sunrise-mode helpers: search forward for sun climbing to el, backward for sun below el
  function timeAfterRising(t0, lat, lng, el, maxMin = 240) {
    for (let m = 0; m <= maxMin; m++) { if (sunPos(t0 + m * 60, lat, lng).elev >= el) return t0 + m * 60; }
    return null;
  }
  function timeBeforeBelow(t0, lat, lng, el, maxMin = 120) {
    for (let m = 0; m <= maxMin; m++) { if (sunPos(t0 - m * 60, lat, lng).elev <= el) return t0 - m * 60; }
    return null;
  }
  // Moon age in days (0 = new, ~14.77 = full)
  const moonAge = t => { const syn = 29.530588853, ref = 947182440; return (((t - ref) / 86400) % syn + syn) % syn; };
  const angDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  // Evaluate one spot for one day (Sunset Metric Bible v1 §0–§13).
  // S = spot forecast, Wl = [W40, W120, W200] forecasts along the sunset azimuth, E = antisolar point (~12 km), AQ = air quality
  function evaluate(sp, S, Wl, E, di, AQ) {
    const RISE = g.AG_MODE === "sunrise", EV = RISE ? "sunrise" : "sunset", DIR = RISE ? "Eastern" : "Western", dir = RISE ? "eastern" : "western";
    const tSet = S.daily[EV][di], h = S.hourly, e = E.hourly, lat = sp.lat, lng = sp.lng;
    const W = Wl[0].hourly; // nearest western point (kept for legacy fields)
    const path = Wl.map((w, k) => ({ km: [40, 120, 200][k], low: at(w.hourly, "cloud_cover_low", tSet), mid: at(w.hourly, "cloud_cover_mid", tSet), high: at(w.hourly, "cloud_cover_high", tSet), precip: at(w.hourly, "precipitation", tSet) }));
    const aqh = AQ && AQ.hourly;
    const s = {
      total: at(h, "cloud_cover", tSet), low: at(h, "cloud_cover_low", tSet), mid: at(h, "cloud_cover_mid", tSet), high: at(h, "cloud_cover_high", tSet),
      rh: at(h, "relative_humidity_2m", tSet), rh850: at(h, "relative_humidity_850hPa", tSet), rh500: at(h, "relative_humidity_500hPa", tSet), rh300: at(h, "relative_humidity_300hPa", tSet),
      temp: at(h, "temperature_2m", tSet), dew: at(h, "dew_point_2m", tSet),
      vis: at(h, "visibility", tSet), wind: at(h, "wind_speed_10m", tSet), gust: at(h, "wind_gusts_10m", tSet), wdir: at(h, "wind_direction_10m", tSet),
      precip: at(h, "precipitation", tSet), pprob: at(h, "precipitation_probability", tSet), cape: at(h, "cape", tSet), code: atCode(h, tSet),
      pres: at(h, "pressure_msl", tSet),
      wLow: path[0].low, wMid: path[0].mid, wHigh: path[0].high, wPrecip: path[0].precip,
      eLow: at(e, "cloud_cover_low", tSet), eMid: at(e, "cloud_cover_mid", tSet),
      aod: aqh ? at(aqh, "aerosol_optical_depth", tSet) : null, pm25: aqh ? at(aqh, "pm2_5", tSet) : null, dust: aqh ? at(aqh, "dust", tSet) : null,
    };
    const priorRain = sumRange(h, "precipitation", tSet - 24 * 3600, tSet - 3600);
    const az = sunPos(tSet, lat, lng).az;
    const hi = s.high / 100, md = s.mid / 100, lo = s.low / 100;

    // ---- §1 timing ----
    // sunrise mirrors sunset in time: twilight/afterglow come BEFORE the event, golden hour AFTER
    const golden = RISE ? timeAfterRising(tSet, lat, lng, 6) : timeBeforeAtElev(tSet, lat, lng, 6);
    const civilEnd = RISE ? timeBeforeBelow(tSet, lat, lng, -6, 120) : timeAtElev(tSet, lat, lng, -6, 120);
    const dom = hi >= 0.2 ? "high" : md >= 0.2 ? "mid" : lo >= 0.2 ? "low" : "clear";
    const hKm = { high: 9, mid: 4, low: 1, clear: 0 }[dom];
    const peakMin = { high: 12, mid: 6, low: 2, clear: 5 }[dom];
    const depress = hKm ? Math.sqrt(2 * hKm / 6371) * DEG + 0.5 : 6; // §1.4 depression angle at which cloud stops being lit
    const glowEnd = RISE ? (timeBeforeBelow(tSet, lat, lng, -depress, 120) || tSet - 20 * 60) : (timeAtElev(tSet, lat, lng, -depress, 120) || tSet + 20 * 60);
    const timing = { rise: RISE, golden, sunset: tSet, peak: tSet + (RISE ? -1 : 1) * peakMin * 60, glowEnd, civilEnd, dom, twilightMin: civilEnd ? Math.round(Math.abs(civilEnd - tSet) / 60) : null };

    // ---- §2.4 western clear slot (low + ½ mid along the sun azimuth, 40/120/200 km) ----
    const blockAt = p => clamp((p.low + 0.5 * p.mid) / 100);
    const slotBlock = 0.45 * blockAt(path[0]) + 0.35 * blockAt(path[1]) + 0.2 * blockAt(path[2]);
    const pathLow = 0.45 * path[0].low + 0.35 * path[1].low + 0.2 * path[2].low;
    const slotQ = pw(slotBlock, [[0, 1], [0.3, 0.85], [0.5, 0.5], [0.7, 0.15], [0.9, 0]]);

    // ---- §2.1/2.2 screen quality ----
    const highQ = pw(hi, [[0, 0], [0.1, 0.3], [0.2, 0.85], [0.3, 1], [0.7, 1], [0.9, 0.6], [1, 0.45]]);
    const midQ = pw(md, [[0, 0], [0.1, 0.35], [0.2, 1], [0.6, 1], [0.85, 0.45], [1, 0.25]]);
    let screen = clamp(Math.max(highQ, 0.92 * midQ) + 0.12 * Math.min(highQ, midQ));
    if (hi > 0.85 && md > 0.6) screen *= 0.75; // thick featureless deck (§2.7)
    const canvasCover = 1 - (1 - hi) * (1 - md);
    // trailing-edge contrast (§2.5): overhead screen counts only as much as light gets in
    const screenEff = screen * (0.35 + 0.65 * slotQ);

    // ---- §3/§4 low-level cleanliness ----
    const aodQ = s.aod != null ? pw(s.aod, [[0, 1], [0.1, 0.95], [0.2, 0.78], [0.4, 0.45], [0.6, 0.2], [1, 0.05]]) : null;
    const pmQ = s.pm25 != null ? pw(s.pm25, [[0, 1], [10, 0.95], [20, 0.7], [35, 0.4], [60, 0.1]]) : null;
    const visQ = s.vis != null ? pw(s.vis / 1609, [[0, 0], [3, 0.2], [5, 0.4], [10, 0.85], [15, 1]]) : 0.8;
    const rhLow = s.rh850 != null ? 0.6 * s.rh + 0.4 * s.rh850 : s.rh;
    const rhQ = pw(rhLow, [[0, 1], [60, 1], [70, 0.8], [80, 0.55], [90, 0.25], [100, 0.1]]);
    const clean = (aodQ ?? 0.8) * 0.35 + (pmQ ?? 0.8) * 0.2 + visQ * 0.2 + rhQ * 0.25;
    const dewDep = s.temp - s.dew;

    // ---- §5 synoptic: front passage / pressure tendency / clearing trend ----
    const p6 = at(h, "pressure_msl", tSet - 6 * 3600), p24 = at(h, "pressure_msl", tSet - 24 * 3600), d24 = at(h, "dew_point_2m", tSet - 24 * 3600);
    const dP6 = s.pres != null && p6 != null ? s.pres - p6 : 0, dP24 = s.pres != null && p24 != null ? s.pres - p24 : 0, dDew = d24 != null ? s.dew - d24 : 0;
    const wLowPrev = at(Wl[0].hourly, "cloud_cover_low", tSet - 3 * 3600);
    const clearingTrend = wLowPrev != null ? (wLowPrev - s.wLow) / 100 : 0;
    // find wind-shift/dew drop timing in last 36 h as a frontal-passage proxy
    let fropaH = null;
    for (let k = 1; k <= 36; k++) { const a = at(h, "dew_point_2m", tSet - k * 3600), b = at(h, "dew_point_2m", tSet - (k + 6) * 3600); if (a != null && b != null && b - a >= 6) { fropaH = k + 3; break; } }
    const syn = clamp(0.35 * pw(dP6, [[-3, 0], [0, 0.3], [1, 0.7], [3, 1]]) + 0.3 * pw(-dDew, [[-2, 0], [0, 0.2], [4, 0.7], [8, 1]]) + 0.2 * (fropaH != null && fropaH >= 6 && fropaH <= 36 ? 1 : 0) + 0.15 * clamp(0.3 + clearingTrend * 2));
    const front = fropaH != null && fropaH <= 36 && dP24 > 1.5;

    // ---- §2.3 low cloud (overhead) ----
    const lowQ = 1 - pw(lo, [[0, 0], [0.2, 0], [0.5, 0.5], [0.6, 0.8], [0.8, 1]]);
    // ---- §4.2 upper moisture ----
    const upQ = s.rh300 != null ? pw(s.rh300, [[0, 0.1], [30, 0.3], [50, 0.8], [70, 1], [90, 1], [100, 0.7]]) : hi > 0.1 ? 0.8 : 0.3;
    // ---- §3.3 elevated smoke/aerosol: AOD high but surface PM low ⇒ aerosol aloft (bonus); both high ⇒ penalty ----
    let smokeQ = 0.5, smokeNote = null;
    if (s.aod != null && s.pm25 != null) {
      if (s.aod > 0.2 && s.aod < 0.6 && s.pm25 < 12) { smokeQ = 0.85; smokeNote = "Aerosol appears to be aloft (AOD up, surface PM2.5 low) — can deepen reds/oranges."; }
      else if (s.aod > 0.5 && s.pm25 > 25) { smokeQ = 0.1; smokeNote = "Dense haze/smoke through the column — expect a dim, muddy sunset."; }
    }

    const comp = [
      { k: DIR + " clear slot", w: 25, q: slotQ },
      { k: "High/mid cloud screen", w: 25, q: screenEff },
      { k: "Clean low-level air", w: 20, q: clean },
      { k: "Post-front / pressure", w: 10, q: syn },
      { k: "Low cloud (overhead)", w: 10, q: lowQ },
      { k: "Moisture aloft", w: 5, q: upQ },
      { k: "Smoke / aerosol aloft", w: 5, q: smokeQ },
    ];
    let sky = comp.reduce((a, c) => a + c.w * c.q, 0);
    const month = new Date(tSet * 1000).getUTCMonth();
    const season = [9, 10, 11, 0, 1].includes(month) ? 1.04 : [5, 6, 7].includes(month) ? 0.95 : 1; // §10.1 weak prior
    sky *= season;

    // ---- §0 gates ----
    const gates = [];
    if (hi + md < 0.1) { sky = Math.min(sky, 55); gates.push("Clear sky: capped at 55 — pretty gradient, nothing to paint."); }
    if (s.vis != null && s.vis < 4830) { sky = Math.min(sky, 45); gates.push("Visibility under ~3 mi: capped at Fair."); }
    if (pathLow >= 90 || Math.max(path[0].low, path[1].low) >= 95) { sky = Math.min(sky, 20); gates.push(`Low overcast along the ${EV} path (out to ~200 km): light can't reach the clouds — Poor.`); }
    if ((s.precip || 0) >= 0.2 || [45, 48].includes(s.code)) { sky = Math.min(sky, 20); gates.push(`${[45, 48].includes(s.code) ? "Fog" : "Rain"} at the spot at ${EV} — Poor for color (rainbow scored separately).`); }
    if (s.total >= 95 && slotBlock >= 0.85) { sky = Math.min(sky, 20); gates.push(`Full overcast with no ${dir} gap — Poor.`); }
    sky = Math.round(clamp(sky, 0, 100));

    // ---- §9 site fit ----
    const inArc = az >= sp.arc[0] && az <= sp.arc[1];
    const off = inArc ? 0 : Math.min(angDiff(az, sp.arc[0]), angDiff(az, sp.arc[1]));
    const alignQ = inArc ? 1 : off <= 15 ? 0.65 : off <= 35 ? 0.35 : 0.15;
    const obstQ = pw(sp.obst, [[0, 1], [1, 0.9], [3, 0.7], [5, 0.4]]);
    const waterQ = sp.water ? 1 : 0.6;
    const mph = s.wind;
    const seaPk = sp.water ? seaState({ wind: s.wind || 0, gust: s.gust || 0, wave: at(h, "wave_m", tSet) }, SEA_EXPO[sp.type] != null ? SEA_EXPO[sp.type] : 0.5) : null;
    const surface = !sp.water ? "No water foreground" : `Water at ${EV}: ${seaPk.name} — ${seaPk.txt}`;
    const windQ = !sp.water ? 0.8 : mph < 5 ? 1 : mph < 15 ? 0.9 : 0.7;
    const site = Math.round(100 * (0.45 * alignQ + 0.25 * obstQ + 0.2 * waterQ + 0.1 * windQ));
    const score = Math.round(sky * (0.78 + 0.22 * site / 100));

    // ---- reasons ----
    const R = [];
    if (slotBlock < 0.25) R.push(`${DIR} light path is open — sunlight can reach the clouds.`);
    else if (slotBlock < 0.55) R.push(`Partial ${dir} gap (${Math.round(slotBlock * 100)}% blocked along the ${EV} line).`);
    else R.push(`${DIR} light path mostly blocked (${Math.round(slotBlock * 100)}%) by low/mid cloud — biggest risk.`);
    if (hi + md < 0.1) R.push("Almost no high or mid cloud — clean gradient but no canvas.");
    else if (screen > 0.75) R.push(`Good screen: ${Math.round(s.high)}% high, ${Math.round(s.mid)}% mid cloud${dom === "high" ? " (cirrus-level, glows longest)" : ""}.`);
    else if (hi > 0.85 && md > 0.6) R.push("Thick, layered deck overhead — tends to go grey unless the sun slips under it.");
    else R.push(`Thin canvas: ${Math.round(s.high)}% high, ${Math.round(s.mid)}% mid.`);
    if (lo > 0.5) R.push(`Low cloud overhead (${Math.round(s.low)}%) will hide the upper layers.`);
    if (clean < 0.6) R.push(`Hazy/humid lower air (RH ${Math.round(rhLow)}%${s.aod != null ? `, AOD ${s.aod.toFixed(2)}` : ""}) mutes color.`);
    else if (clean > 0.85) R.push("Clean, dry low-level air — crisp, saturated color.");
    if (front) R.push(`Post-frontal air: drier air arrived ~${fropaH} h ago and pressure is up ${dP24.toFixed(1)} hPa in 24 h — often the week's best setup.`);
    else if (dP6 > 1) R.push(`Pressure rising (+${dP6.toFixed(1)} hPa/6h) — clearing tendency.`);
    if (smokeNote) R.push(smokeNote);
    if (!inArc) R.push(`${RISE ? "This sunrise" : "Tonight's sunset"} azimuth (${Math.round(az)}°) is ${Math.round(off)}° outside this spot's open view — seasonal mismatch.`);

    // ---- §6/§7/§8 wow badges ----
    let dog = { p: 0, t: null }, bow = { p: 0, t: null }, halo = { p: 0 }; const bowSer = [];
    for (let k = 0; k <= 16; k++) {
      const t = RISE ? tSet + k * 900 : tSet - 4 * 3600 + k * 900;
      const pos = sunPos(t, lat, lng); if (pos.elev < 0.3) continue;
      const H = at(h, "cloud_cover_high", t) / 100, Hw = at(Wl[0].hourly, "cloud_cover_high", t) / 100;
      const L = at(h, "cloud_cover_low", t) / 100, M = at(h, "cloud_cover_mid", t) / 100;
      const WL = at(Wl[0].hourly, "cloud_cover_low", t) / 100, WM = at(Wl[0].hourly, "cloud_cover_mid", t) / 100;
      const pr = at(h, "precipitation", t) || 0;
      const sunVis = clamp((1 - Math.max(WL, L * 0.6)) * (1 - 0.85 * Math.max(WM, M * 0.5)));
      const cir = (H + Hw) / 2;
      const thin = pw(cir, [[0, 0], [0.08, 0.15], [0.25, 0.85], [0.6, 1], [0.85, 0.6], [1, 0.35]]);
      // §7.1 sun dogs: sun < 30° (best < 15°), thin cirrus/Cs near the sun, sun disk visible
      const elevF = pos.elev < 15 ? 1 : pos.elev < 30 ? 0.55 : 0;
      const pd = 0.5 * thin * sunVis * elevF * (pr > 0.2 ? 0.3 : 1);
      if (pd > dog.p) dog = { p: pd, t, elev: pos.elev, cir, sunVis };
      // §7.2 22° halo (partial arcs near sunset)
      const ph = 0.4 * pw(cir, [[0, 0], [0.2, 0.3], [0.5, 0.9], [0.9, 1], [1, 0.8]]) * sunVis * (pos.elev < 40 ? 1 : 0.6);
      if (ph > halo.p) halo = { p: ph, t };
      // §6 rainbows: sun < 42°, rain to the east 1–30 km, clear west (<30% low/mid), viewer dry
      if (pos.elev < 42) {
        const ep = at(e, "precipitation", t) || 0, epp = (at(e, "precipitation_probability", t) || 0) / 100;
        const ec = atCode(e, t), sc = atCode(h, t);
        const rainEast = clamp(Math.max(ep / 1.0, epp * 0.75));
        const conv = isShowery(ec) || isShowery(sc) ? 1 : isRain(ec) || isRain(sc) ? 0.55 : 0.4;
        const clearW = pw(Math.max(WL, WM * 0.8), [[0, 1], [0.3, 0.8], [0.6, 0.25], [0.9, 0]]);
        const dry = pr > 1 ? 0.2 : pr > 0.3 ? 0.6 : 1;
        const pb = 0.6 * rainEast * conv * clearW * dry;
        bowSer.push({ t, p: pb });
        if (pb > bow.p) bow = { p: pb, t, elev: pos.elev, red: RISE ? t <= tSet + 15 * 60 : t >= tSet - 15 * 60, rainEast, clearW, shower: conv === 1, dry };
      }
    }
    const wLoBlock = slotBlock;
    // rainbow window: contiguous 15-min steps around the peak where odds stay ≥ half the peak (min 3%)
    let bowWin = null;
    if (bow.t && bowSer.length) {
      const thr = Math.max(0.03, bow.p * 0.5), k0 = bowSer.findIndex(x => x.t === bow.t);
      let a = k0, b = k0;
      while (a > 0 && bowSer[a - 1].p >= thr && bowSer[a - 1].t === bowSer[a].t - 900) a--;
      while (b < bowSer.length - 1 && bowSer[b + 1].p >= thr && bowSer[b + 1].t === bowSer[b].t + 900) b++;
      let st = bowSer[a].t - 450, en = bowSer[b].t + 450;
      // geometry: no bow once the sun is below the horizon (sunset) / before it rises (sunrise)
      if (RISE) st = Math.max(st, tSet); else en = Math.min(en, tSet);
      bowWin = { start: st, end: en, min: Math.max(15, Math.round((en - st) / 60 / 5) * 5) };
    }
    const P100 = x => Math.round(clamp(x) * 100), P100w = P100;
    // ---- Weather DURING the event window (icons on map/list/detail + preview) & lightning odds ----
    // Window: sunset = 90 min before → 30 min after; sunrise = 30 min before → 90 min after (golden hour + glow).
    const WX0 = RISE ? tSet - 30 * 60 : tSet - 90 * 60, WX1 = RISE ? tSet + 90 * 60 : tSet + 30 * 60;
    const isThunder = c => c === 95 || c === 96 || c === 99, isSnow = c => (c >= 71 && c <= 77) || c === 85 || c === 86, isFog = c => c === 45 || c === 48;
    const wxSer = [];
    for (let t = WX0; t <= WX1; t += 900) {
      const sc = atCode(h, t), ec = atCode(e, t), cape = at(h, "cape", t) || 0, pp = (at(h, "precipitation_probability", t) || 0) / 100, epp = (at(e, "precipitation_probability", t) || 0) / 100;
      const pr = at(h, "precipitation", t) || 0, ep = at(e, "precipitation", t) || 0, wp = at(W, "precipitation", t) || 0;
      // lightning odds: thunderstorm code at the spot (0.70+) or ~12 km on the rainbow side (0.60+), else convective potential (CAPE × rain chance)
      const capeF = pw(cape, [[0, 0], [300, 0], [600, 0.1], [1000, 0.25], [2000, 0.5], [3000, 0.65]]);
      const conv = capeF * clamp(Math.max(pp, epp) * 1.1) * (isShowery(sc) || isShowery(ec) ? 1 : 0.6);
      const lp = clamp(Math.max(isThunder(sc) ? 0.7 + 0.25 * capeF : 0, isThunder(ec) ? 0.6 + 0.25 * capeF : 0, conv), 0, 0.95);
      wxSer.push({ t, sc, ec, lp, where: isThunder(sc) ? "at the spot" : isThunder(ec) ? `~12 km ${RISE ? "west" : "east"}` : "nearby (unstable air)",
        pr, ep, wp, pp, wind: at(h, "wind_speed_10m", t) || 0, gust: at(h, "wind_gusts_10m", t) || 0, wdir: at(h, "wind_direction_10m", t), wave: at(h, "wave_m", t),
        low: at(h, "cloud_cover_low", t) || 0, tot: at(h, "cloud_cover", t) || 0, vis: at(h, "visibility", t) });
    }
    const mx = k => wxSer.reduce((a, x) => Math.max(a, x[k] || 0), 0);
    const bolt = wxSer.reduce((a, x) => x.lp > a.lp ? x : a, { lp: 0, t: null, where: "" });
    let boltWin = null;
    if (bolt.t && bolt.lp >= 0.1) { const thr = Math.max(0.1, bolt.lp * 0.5), on = wxSer.filter(x => x.lp >= thr); boltWin = { start: on[0].t - 450, end: on[on.length - 1].t + 450 }; }
    const rainMm = mx("pr"), rainPp = mx("pp"), anyCode = f => wxSer.some(x => f(x.sc)), windMx = mx("wind"), gustMx = mx("gust"), lowMx = mx("low"), totMx = mx("tot");
    const visMin = wxSer.reduce((a, x) => x.vis != null ? Math.min(a, x.vis) : a, 1e9);
    const wx = { win: { start: WX0, end: WX1 }, items: [] };
    const boltP = P100w(bolt.lp);
    if (boltP >= 25) wx.items.push({ id: "bolt", icon: "⚡", name: boltP >= 40 ? "Lightning likely" : "Lightning possible", p: boltP, t: bolt.t, win: boltWin, txt: `Thunderstorms ${bolt.where} — ${boltP}% lightning odds in the ${EV} window.` });
    if (anyCode(isSnow)) wx.items.push({ id: "snow", icon: "❄️", name: "Snow", txt: `Snow in the forecast during ${EV}.` });
    else if (rainMm >= 0.2 || anyCode(c => isRain(c) || isShowery(c))) wx.items.push({ id: "rain", icon: "🌧️", name: anyCode(c => c >= 51 && c <= 57) && rainMm < 0.5 ? "Drizzle" : rainMm >= 2.5 ? "Heavy rain" : "Rain", mm: +rainMm.toFixed(1), pp: Math.round(rainPp * 100), txt: `Rain at the spot during ${EV}: up to ${rainMm.toFixed(1)} mm/h (${Math.round(rainPp * 100)}% chance).` });
    else if (rainPp >= 0.5) wx.items.push({ id: "rain", icon: "🌦️", name: "Showers possible", pp: Math.round(rainPp * 100), txt: `${Math.round(rainPp * 100)}% chance of rain during ${EV}.` });
    if (windMx >= 15 || gustMx >= 25) wx.items.push({ id: "wind", icon: "💨", name: windMx >= 25 || gustMx >= 40 ? "Very windy" : "Windy", mph: Math.round(windMx), gust: Math.round(gustMx), txt: `Wind up to ${Math.round(windMx)} mph, gusts ${Math.round(gustMx)} mph${s.wdir != null ? ` from the ${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(s.wdir / 45) % 8]}` : ""}.` });
    if (anyCode(isFog) || visMin < 1000) wx.items.push({ id: "fog", icon: "🌫️", name: "Fog", txt: `Fog / visibility down to ${visMin < 1e8 ? (visMin / 1609).toFixed(1) + " mi" : "low"} during ${EV}.` });
    else if (totMx >= 90 || lowMx >= 80) wx.items.push({ id: "cloud", icon: "☁️", name: "Overcast", txt: `${Math.round(Math.max(totMx, lowMx))}% cloud overhead during ${EV} — sky may stay grey.` });
    wx.bolt = { p: boltP, t: bolt.t, win: boltWin, where: bolt.where };
    wx.wind = { mph: Math.round(windMx), gust: Math.round(gustMx), dir: s.wdir };
    wx.rain = { mm: +rainMm.toFixed(1), pp: Math.round(rainPp * 100) };
    // ---- WATER SURFACE through the event window (wind / gusts every 15 min + wave height toward the sun when the marine model has it) ----
    const sea = sp.water ? { ser: wxSer.map(x => ({ t: x.t, wind: x.wind, gust: x.gust, wave: x.wave })), expo: SEA_EXPO[sp.type] != null ? SEA_EXPO[sp.type] : 0.5 } : null;
    // ---- TRIFECTA: epic color + epic rainbow + epic lightning lined up in the same window ----
    const EP = EPIC;
    const bowP = P100w(bow.p);
    const legs = { color: score >= EP.color, bow: bowP >= EP.bow, bolt: boltP >= EP.bolt };
    // the rainbow window and the lightning window must overlap (±30 min) inside the event window
    const bw0 = bowWin ? Math.max(bowWin.start, WX0) : null, bw1 = bowWin ? Math.min(bowWin.end, WX1) : null;
    const lined = !!(bowWin && boltWin && bw0 < bw1 && boltWin.start <= bw1 + 1800 && boltWin.end >= bw0 - 1800);
    const nLegs = +legs.color + legs.bow + legs.bolt;
    const tri = { on: nLegs === 3 && lined, n: nLegs, legs, lined, color: score, bow: bowP, bolt: boltP,
      start: lined ? Math.max(bw0, boltWin.start) : null, end: lined ? Math.min(bw1, boltWin.end) : null };
    // ---- BONUS cards (sun dogs / rainbows): explicit odds % + data-driven why (Metric Bible §6/§7) ----
        const SUNSIDE = RISE ? "east" : "west", ANTI = RISE ? "west" : "east";
    const bonus = {
      dog: { id: "dog", name: "Sun dogs", icon: "◉", p: P100(dog.p), t: dog.t,
        why: dog.p >= 0.03 ? `Sun dogs ${P100(dog.p)}% — ${Math.round((dog.cir || 0) * 100)}% thin cirrus/ice cloud with the sun at ${dog.elev.toFixed(0)}° and ${Math.round((dog.sunVis || 0) * 100)}% sun-disk visibility. Look ~22° left & right of the sun.`
          : `Sun dogs ~0% — needs thin cirrus/ice cloud and a visible sun below ~25°; ${Math.round(hi * 100)}% high cloud ${RISE ? "this morning" : "today"}.`,
        look: "22° either side of the sun" },
      bow: { id: "bow", name: bow.red ? "Red rainbow" : "Rainbow", icon: "🌈", p: P100(bow.p), t: bow.t, red: !!bow.red, win: bowWin,
        why: bow.p >= 0.03 ? `Rainbow ${P100(bow.p)}% — ${Math.round((bow.rainEast || 0) * 100)}% rain signal to the ${ANTI}${bow.shower ? " (showers)" : ""}, ${SUNSIDE} sky ${Math.round((bow.clearW || 0) * 100)}% clear for sunlight, sun at ${bow.elev.toFixed(0)}° (< 42°). Look ${ANTI}, opposite the sun.${bow.red ? ` Sun this low turns the bow red/orange.` : ""}`
          : `Rainbow ~0% — needs showers to the ${ANTI}, a clear ${SUNSIDE} sky and the sun under 42°; no rain is forecast on the ${ANTI} side.`,
        look: `${ANTI}, opposite the sun` },
    };
    const pct = x => Math.round(clamp(x) * 100);
    const badges = [
      { id: "dog", name: "Sun dogs", p: pct(dog.p), t: dog.t, icon: "◉", why: dog.p >= 0.1 ? "Thin cirrus with a visible low sun — look ~22° left and right of the sun." : "Needs thin cirrus/cirrostratus with the sun visible below ~25°." },
      { id: "halo", name: "22° halo", p: pct(halo.p), t: halo.t, icon: "◯", why: "Ring 22° around the sun from cirrostratus; near sunset only partial arcs show." },
      { id: "bow", name: bow.red ? "Red rainbow" : "Rainbow", p: pct(bow.p), t: bow.t, icon: "🌈", why: `${pct(bow.p)}% odds. ` + (RISE ? (bow.p >= 0.1 ? `Showers west while the sun shines from the east — look west (antisolar point).${bow.red ? " Right after sunrise the bow is red/orange." : ""}` : "Needs showers to the west, a clear eastern sky, and a dry viewer.") : bow.p >= 0.1 ? `Showers east while the sun shines from the west — look east (antisolar point).${bow.red ? " Near sunset the bow turns red/orange." : ""}` : "Needs showers to the east, a clear western sky, and a dry viewer.") },
      { id: "pillar", name: "Sun pillar", p: pct(0.4 * pw(hi, [[0, 0], [0.15, 0.4], [0.4, 1], [0.8, 0.7], [1, 0.4]]) * (1 - wLoBlock) * (s.temp < 40 ? 1.3 : 1)), t: tSet + (RISE ? -3 : 3) * 60, icon: "┃", why: "Vertical light column from plate crystals as the sun nears/just clears the horizon." },
      { id: "rays", name: "Crepuscular rays", p: pct(0.7 * pw((path[0].low + path[0].mid * 0.5) / 100, [[0, 0], [0.2, 0.4], [0.35, 1], [0.65, 1], [0.85, 0.2]]) * (s.aod != null ? pw(s.aod, [[0, 0.5], [0.1, 1], [0.3, 1], [0.6, 0.5]]) : 0.8)), t: tSet + (RISE ? 10 : -10) * 60, icon: "☀", why: `Broken cloud on the ${dir} horizon plus a little haze casts visible shafts.` },
      { id: "venus", name: "Belt of Venus", p: pct(0.8 * (1 - clamp(((s.eLow || 0) + (s.eMid || 0) * 0.6) / 100)) * clean * (1 - hi * 0.6)), t: tSet + (RISE ? -10 : 10) * 60, icon: "▬", why: RISE ? "Pink band above Earth's blue shadow in the WEST, ~5–20 min before sunrise. Needs a clear western sky." : "Pink band above Earth's blue shadow in the EAST, ~5–20 min after sunset. Needs a clear eastern sky." },
      { id: "flash", name: "Green flash", p: pct(sp.water && sp.obst <= 0.5 && inArc ? 0.35 * (1 - clamp(slotBlock * 3)) * (aodQ ?? 0.7) * (1 - lo) : 0), t: tSet, icon: "●", why: `Needs a flat water horizon, clean air and zero cloud at the horizon. ${RISE ? "Watch the very first sliver of sun." : "Watch the very last sliver of sun."}` },
    ];
    const age = moonAge(tSet);
    if (RISE) {
      if (Math.abs(age - 14.77) <= 1.6) badges.push({ id: "moon", name: "Full moon set", p: 80, t: tSet, icon: "🌕", why: "Moon sets in the west near sunrise, opposite the sun." });
      else if (age >= 25 && age <= 28.3) badges.push({ id: "moon", name: "Crescent moon", p: 60, t: tSet - 20 * 60, icon: "🌘", why: "Thin waning crescent low in the east in the dawn glow." });
    }
    else if (Math.abs(age - 14.77) <= 1.6) badges.push({ id: "moon", name: "Full moon rise", p: 80, t: tSet, icon: "🌕", why: `Moon ${age < 14.77 ? "rises shortly before" : "rises shortly after"} sunset, opposite the sun.` });
    else if (age >= 1.2 && age <= 4.5) badges.push({ id: "moon", name: "Crescent moon", p: 60, t: tSet + 20 * 60, icon: "🌒", why: "Thin crescent low in the west in the afterglow." });

    return { tSet, score, sky, site, s, path, priorRain, reasons: R, gates, comp, badges, bonus, wx, tri, dog: { p: pct(dog.p), t: dog.t }, bow: { p: pct(bow.p), t: bow.t },
      sea, clouds: cloudTypes(s), sunsetAz: az, canvasCover, slotBlock, clean, rhLow, dewDep, dP6, dP24, dDew, fropaH, front, timing,
      siteInfo: { inArc, off, alignQ, obst: sp.obst, water: sp.water, surface, arc: sp.arc }, season, screen };
  }


  // ---- Water surface state (drives the animation): continuous 0..1 scales, not just buckets ----
  // Effective wind = sustained + 30% of the gust excess (gusts roughen the surface in cat's-paw patches).
  // chop:   0 glassy (< 2 mph) · .12 light ripples (4) · .28 small wavelets (7) · .45 light chop (11) · .6 choppy (15) · .75 rough (20) · .87 (25) · 1 (32+ mph)
  // caps:   whitecaps start ~10 mph (Beaufort 3 "scattered"), widespread by ~28 mph; breaking surf adds caps on exposed beaches when waves ≥ ~3 ft
  // mirror: 1 = mirror-still reflections, fades out by ~9 mph
  // swell:  wave height (Open-Meteo marine, ~6 km toward the sun) — 0.5 ft .08 · 1 ft .2 · 2 ft .4 · 3 ft .58 · 5 ft .8 · 8 ft 1, × exposure (sheltered marsh/harbor 0.35–0.45)
  const SEA_EXPO = { Beach: 1, Pier: 1, Lighthouse: 0.9, Bluff: 0.9, Boardwalk: 0.6, Dunes: 0.6, Waterfront: 0.45, Harbor: 0.4, Marsh: 0.35 };
  const SEA_CHOP = [[0, 0], [2, 0.03], [4, 0.12], [7, 0.28], [11, 0.45], [15, 0.6], [20, 0.75], [25, 0.87], [32, 1]];
  function seaState(x, expo = 0.5) {
    const wind = x.wind || 0, gust = Math.max(wind, x.gust || 0), eff = wind + 0.3 * (gust - wind);
    const ft = x.wave != null && isFinite(x.wave) ? x.wave * 3.281 : null;
    const chop = pw(eff, SEA_CHOP);
    const swell = ft != null ? pw(ft, [[0, 0], [0.5, 0.08], [1, 0.2], [2, 0.4], [3, 0.58], [5, 0.8], [8, 1]]) * expo : chop * 0.5 * expo;
    const caps = clamp(Math.max(pw(eff, [[0, 0], [9, 0], [12, 0.15], [16, 0.38], [20, 0.6], [28, 0.92], [35, 1]]), ft != null ? clamp((ft - 3) / 6) * expo * 0.7 : 0));
    const mirror = clamp(1 - pw(eff, [[0, 0], [2, 0.05], [4, 0.3], [6, 0.6], [9, 1]]));
    const name = eff < 3 ? "Glassy" : eff < 7 ? "Calm" : eff < 11 ? "Light chop" : eff < 16 ? "Choppy" : eff < 22 ? "Rough" : "Very rough";
    const txt = (eff < 3 ? "slick, mirror reflections" : eff < 7 ? "light ripples, strong reflections" : eff < 11 ? "small wavelets, glitter path, softened reflections" : eff < 16 ? "scattered whitecaps, broken reflections" : eff < 22 ? "frequent whitecaps, reflections gone" : "whitecaps & spray everywhere")
      + ` (wind ${Math.round(wind)} mph, gusts ${Math.round(gust)}${ft != null ? `, ${ft < 1 ? "waves under 1 ft" : `waves ~${Math.round(ft)} ft`}` : ""})`;
    return { chop, swell, caps, mirror, eff, wind, gust, ft, name, txt };
  }
  // sea state at any moment of the event window (interpolated between the 15-min forecast steps)
  function seaAt(ev, t) {
    const S = ev && ev.sea; if (!S || !S.ser.length) return null;
    const a = S.ser; let i = 0; while (i < a.length - 2 && a[i + 1].t <= t) i++;
    const p = a[i], q = a[Math.min(i + 1, a.length - 1)], f = q.t > p.t ? clamp((t - p.t) / (q.t - p.t)) : 0;
    const L = k => p[k] == null ? q[k] : q[k] == null ? p[k] : p[k] + (q[k] - p[k]) * f;
    return seaState({ wind: L("wind"), gust: L("gust"), wave: L("wave") }, S.expo);
  }

  function label(score) {
    if (score >= 85) return { t: "Epic", c: "#ff4f9a" };
    if (score >= 70) return { t: "Great", c: "#ff7a3d" };
    if (score >= 50) return { t: "Good", c: "#ffb347" };
    if (score >= 30) return { t: "Fair", c: "#c9a46a" };
    return { t: "Poor", c: "#6f7590" };
  }
  // "Epic" thresholds for the Trifecta (all three must line up at the same spot & window)
  const EPIC = { color: 85, bow: 40, bolt: 40 };
  const likely = p => p >= 40 ? "High" : p >= 22 ? "Moderate" : p >= 10 ? "Low" : "Unlikely";

  g.Model = { sunPos, offset, evaluate, label, likely, clamp, timeAtElev, EPIC, seaState, seaAt };
})(window);
