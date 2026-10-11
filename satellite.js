// Live GOES-East satellite context. Tiles: Iowa Environmental Mesonet (CORS-enabled XYZ cache of GOES-East ABI).
(function (g) {
  const IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/";
  const LAYERS = { vis: "goes_east_conus_ch02", cirrus: "goes_east_conus_ch04", ir: "goes_east_conus_ch13", radar: "nexrad-n0q-900913" };
  const bust = () => Math.floor(Date.now() / 300000); // 5-minute cache key
  const tileUrl = (layer) => `${IEM}${LAYERS[layer]}/{z}/{x}/{y}.png?_=${bust()}`;
  const imgCache = {};
  function loadImg(url) {
    if (imgCache[url]) return imgCache[url];
    return (imgCache[url] = new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = rej; im.src = url; }));
  }
  function tileXY(lat, lng, z) {
    const n = 2 ** z, x = (lng + 180) / 360 * n, lr = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n;
    return { tx: Math.floor(x), ty: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
  }
  // sample a square of pixels (radius in px) around lat/lng; returns array of [r,g,b,a]
  async function sample(layer, lat, lng, z = 7, rad = 6) {
    const { tx, ty, px, py } = tileXY(lat, lng, z);
    const url = `${IEM}${LAYERS[layer]}/${z}/${tx}/${ty}.png?_=${bust()}`;
    const im = await loadImg(url);
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const ctx = c.getContext("2d"); ctx.drawImage(im, 0, 0);
    const x0 = Math.max(0, px - rad), y0 = Math.max(0, py - rad), w = Math.min(256 - x0, rad * 2), h = Math.min(256 - y0, rad * 2);
    const d = ctx.getImageData(x0, y0, w, h).data, out = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2], d[i + 3]]);
    return out;
  }
  // Visible ch02: brightness ~ cloud reflectance
  function readVis(px, tb = 170, tt = 95) {
    const v = px.filter(p => p[3] > 0).map(p => (p[0] + p[1] + p[2]) / 3);
    if (!v.length) return null;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const bright = v.filter(x => x > tb).length / v.length, mid = v.filter(x => x > tt && x <= tb).length / v.length;
    return { mean, bright, thin: mid, clear: 1 - bright - mid };
  }
  // IR ch13 (IEM palette): greyscale = warmer tops (low cloud / clear), colors = cold tops (high/deep cloud)
  function readIR(px) {
    const v = px.filter(p => p[3] > 0); if (!v.length) return null;
    let warm = 0, coolGrey = 0, cold = 0, deep = 0;
    for (const [r, gg, b] of v) {
      const sat = Math.max(r, gg, b) - Math.min(r, gg, b), lum = (r + gg + b) / 3;
      if (sat < 30) { lum < 70 ? warm++ : lum < 165 ? coolGrey++ : cold++; }
      else if ((r > 180 && gg < 120) || lum < 40) deep++;   // red/black = very cold convective tops
      else cold++;                                         // green/blue/purple = high cold cloud
    }
    const n = v.length;
    return { warm: warm / n, coolGrey: coolGrey / n, cold: cold / n, deep: deep / n };
  }
  async function readSpot(spot, westPt, sunElevNow) {
    const res = { when: new Date(), daylight: sunElevNow > 6 };
    try {
      const [irS, irW] = await Promise.all([sample("ir", spot.lat, spot.lng), sample("ir", westPt.lat, westPt.lng)]);
      res.irSpot = readIR(irS); res.irWest = readIR(irW);
      if (res.daylight) {
        const [vS, vW, cS, cW] = await Promise.all([sample("vis", spot.lat, spot.lng), sample("vis", westPt.lat, westPt.lng), sample("cirrus", spot.lat, spot.lng), sample("cirrus", westPt.lat, westPt.lng)]);
        res.visSpot = readVis(vS); res.visWest = readVis(vW); res.cirSpot = readVis(cS, 110, 40); res.cirWest = readVis(cW, 110, 40); // band 4 is dimmer: thin cirrus ~40–110
      }
    } catch (e) { res.error = "Satellite tiles unavailable right now."; return res; }
    res.text = interpret(res);
    return res;
  }
  const pct = x => Math.round(x * 100) + "%";
  // Combine bands: visible = texture/haze, band 4 = thin high cloud, IR = cloud-top temperature
  function classify(vis, cir, ir) {
    if (!ir) return null;
    const highIR = ir.cold + ir.deep;
    const visCloud = vis ? vis.bright + vis.thin * 0.6 : null;
    const cirrus = cir ? cir.bright + cir.thin * 0.6 : null;
    if (ir.deep > 0.15) return { k: "storm", t: "deep convective storm tops" };
    if (vis && visCloud > 0.5 && cirrus != null && cirrus < 0.15 && highIR < 0.15) return { k: "stratus", t: "low stratus/stratocumulus (bright visible, dark cirrus band, warm IR)" };
    if ((cirrus != null && cirrus > 0.25) || (highIR > 0.15 && (!vis || vis.bright < 0.6))) {
      if (vis && vis.bright > 0.65 && highIR > 0.6) return { k: "thick", t: "thick high/mid deck (bright & cold)" };
      return { k: "cirrus", t: "thin high cloud / cirrus" };
    }
    if (highIR > 0.6) return { k: "thick", t: "extensive cold upper cloud" };
    if (vis ? visCloud < 0.25 : ir.coolGrey < 0.3) return { k: "clear", t: "mostly clear" };
    return { k: "mixed", t: "mixed low/mid cloud" };
  }
  function interpret(r) {
    const lines = [];
    const over = classify(r.visSpot, r.cirSpot, r.irSpot), west = classify(r.visWest, r.cirWest, r.irWest);
    if (over) lines.push(`Overhead right now: <b>${over.t}</b>.` + ({ cirrus: " That's the ideal canvas for color.", stratus: " Low cloud like this hides any color above it.", thick: " Too thick to light up evenly — needs a gap at the horizon.", storm: " Storms nearby — watch for dramatic breaks and rainbows to the east.", clear: " Nothing to paint unless clouds move in.", mixed: "" }[over.k] || ""));
    if (west) lines.push(`Toward the sunset (~80 km): <b>${west.t}</b>.` + ({ stratus: " That's the classic sunset-killer — it would block the light if it's still there at sunset.", clear: " Open light path — good.", cirrus: " Thin high cloud there lets light through.", thick: " Could dim the light; watch for a clear slot on the horizon.", storm: " Storms in the light path — risky but can produce wild skies if they clear.", mixed: " Watch for breaks." }[west.k] || ""));
    if (!r.daylight) lines.push("Visible and cirrus bands are dark at night — this read uses infrared only.");
    lines.push("Satellite is a snapshot of now; most useful within ~3–6 hours of sunset.");
    return lines;
  }
  g.Sat = { tileUrl, readSpot, LAYERS };
})(window);
