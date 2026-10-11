// Afterglow photoreal sky renderer (WebGL2).
// Physically-based: spherical Earth, Rayleigh + Mie + ozone single scattering (Chapman optical depth, Earth's shadow),
// three cloud decks (cirrus ~9 km, altocumulus ~4.5 km, low ~1.4 km) on curved shells lit by the sunlight that actually
// reaches each cloud point (so cirrus stays lit minutes after the low deck goes grey), aerial perspective, a microfacet
// ocean that reflects the rendered sky with a sun glitter path, filmic tone mapping, lens glare and film grain.
// Every input is a forecast number from the app (HRRR/GOES/METAR-driven where available).
(function (g) {
  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

  const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform vec3 uSun;      // geometric sun direction (local frame, y up, -z = view azimuth)
uniform vec3 uSunA;     // apparent (refracted) sun direction
uniform vec3 uSunC;     // sun direction for lighting cloud decks: lifted by the refraction a grazing ray picks up along its whole path
uniform vec3 uCov;      // high, mid, low cloud fraction 0..1
uniform float uBlock;   // western low-cloud blockage along the sunset line 0..1
uniform float uAod;     // aerosol optical depth (550 nm)
uniform float uRH;      // low-level relative humidity 0..1
uniform float uExpo;
uniform float uWater, uPier, uShore, uHills;
uniform float uCamH;    // camera height km
uniform float uPitch, uFov;
uniform vec2 uSeed;
uniform float uWind;    // upper wind direction (rad) – cloud streak orientation
uniform float uLQ;      // 1 = low quality (dragging)
uniform float uGrainT;
uniform float uDog;
uniform float uMeter;
uniform float uPixScale;
uniform float uTwi;

const float PI = 3.14159265;
const float R0 = 6360.0;
const float RT = 6420.0;
const float HR = 8.0;
const float HM = 1.2;
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const vec3 BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);
const float ESUN = 22.0;
float BMs, BMe;

// ---------- noise ----------
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  float a = h12(i), b = h12(i+vec2(1,0)), c = h12(i+vec2(0,1)), d = h12(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }
// band-limited fbm: octaves finer than the pixel footprint fade out (no sparkle near the horizon)
float fbm(vec2 p, float fp, int oct){
  float s = 0., a = .5, w = 0., l = 1.;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float k = 1. - smoothstep(.25, .6, fp / l);
    s += a * k * vn(p) + a * (1. - k) * .5; w += a;
    p = m * p + 3.1; a *= .5; l *= .5;
  }
  return s / w;
}
float worley(vec2 p){ vec2 i = floor(p), f = fract(p); float d = 9.;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ vec2 g = vec2(x,y); vec2 r = g + .15 + .7*h22(i+g) - f; d = min(d, dot(r,r)); }
  return sqrt(d); }

// ---------- atmosphere ----------
float chapman(float X, float h, float mu){
  float c = sqrt(X + h);
  if (mu >= 0.) return c / (c*mu + 1.) * exp(-h);
  float x0 = sqrt(1. - mu*mu) * (X + h); float c0 = sqrt(x0);
  return 2.*c0*exp(X - x0) - c/(1. - c*mu)*exp(-h);
}
vec2 sph(vec3 ro, vec3 rd, float r){ float b = dot(ro,rd), c = dot(ro,ro) - r*r, d = b*b - c; if (d < 0.) return vec2(-1.); d = sqrt(d); return vec2(-b-d, -b+d); }
float ozoneLen(vec3 p, vec3 d){
  vec2 a = sph(p, d, R0+35.), b = sph(p, d, R0+15.);
  float la = max(a.y, 0.) - max(a.x, 0.);
  float lb = b.x < -.5 && b.y < -.5 ? 0. : max(b.y, 0.) - max(b.x, 0.);
  return max(la - lb, 0.) * .5;   // tent profile ~ half of the shell path
}
// sunlight transmittance from world point p (Earth-centred) toward sun
vec3 sunT(vec3 p, vec3 s){
  float r = length(p); float mu = dot(p, s) / r; float h = max(r - R0, 0.);
  float sh = 1.;
  if (mu < 0.){
    // Earth's shadow, softened by refraction (~0.6°) and multiple scattering: below the geometric tangent we keep the
    // grazing-ray colour and fade it out over a few km of tangent depth
    float hmin = r*sqrt(1.-mu*mu) - R0;
    if (hmin < -6.) return vec3(0.);
    sh = smoothstep(-6., .5, hmin); sh *= sh;
    if (hmin < .05) mu = -sqrt(max(0., 1. - (R0+.05)*(R0+.05)/(r*r)));
  }
  float tr = HR * chapman(R0/HR, h/HR, mu);
  float tm = HM * chapman(R0/HM, h/HM, mu);
  vec3 tau = BR*tr + BMe*tm + BO*ozoneLen(p, s);
  return exp(-min(tau, vec3(60.))) * sh;
}
float phR(float c){ return 3./(16.*PI)*(1.+c*c); }
float phHG(float c, float g){ float g2 = g*g; return (1.-g2)/(4.*PI*pow(1.+g2-2.*g*c, 1.5)); }

struct Acc { vec3 L; vec3 T; };
void seg(inout Acc A, vec3 ro, vec3 rd, float t0, float t1, int n, float cs){
  float pr = phR(cs), pm = mix(phHG(cs, .82), phHG(cs, .2), .25);
  for (int i = 0; i < 12; i++){
    if (i >= n) break;
    float a = (float(i)+.5)/float(n);
    float ta = t0 + (t1-t0)*a, dt = (t1-t0)/float(n);
    vec3 p = ro + rd*ta; float h = length(p) - R0;
    float dR = exp(-h/HR), dM = exp(-h/HM), dO = max(0., 1.-abs(h-25.)/15.);
    vec3 ext = BR*dR + BMe*dM + BO*dO;
    vec3 Ts = sunT(p, uSun);
    vec3 S = Ts * (BR*dR*pr + BMs*dM*pm) * ESUN;
    // crude multiple-scattering fill (keeps blue hour from going black)
    S += ESUN * (BR*dR) * .045 * sunT(p + normalize(p)*20., uSun) ;
    vec3 Te = exp(-ext*dt);
    A.L += A.T * S * (1. - Te) / max(ext, vec3(1e-6));
    A.T *= Te;
  }
}

// ---------- clouds ----------
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
float dens(int L, vec2 p, float fp, float dist){
  p += uSeed * (float(L)+1.);
  if (L == 0){ // cirrus / cirrostratus
    float cov = uCov.x;
    vec2 q = rot(uWind) * p;
    float warp = fbm(q*.03, fp*.03, 3);
    vec2 s = vec2(q.x*.03, q.y*.09) + warp*1.9;
    float n = fbm(s, fp*.12, 6);
    float macro = fbm(q*.006 + 7., fp*.006, 3);
    float fib = fbm(vec2(q.x*.07, q.y*.45) + warp*2.5, fp*.45, 5);
    float thr = mix(.82, .18, cov) + (.5-macro)*.35;
    float d = smoothstep(thr, thr + .22, n*.7 + fib*.3 + (macro-.5)*.2);
    float hair = fbm(vec2(q.x*.05, q.y*1.4) + warp*3. + n*2., fp*1.4, 4);
    d *= (.45 + .7*fib) * (.62 + .55*smoothstep(.2,.85,hair));
    d *= .8 + .4*fbm(q*.05 + 21., fp*.05, 4);   // patchy thickness, not uniform brush strokes
    float veil = smoothstep(.55, 1., cov) * (.4 + .35*n);
    return clamp(max(d, veil), 0., 1.);
  } else if (L == 1){ // altocumulus
    float cov = uCov.y;
    vec2 q = rot(uWind + .4) * p;
    float macro = fbm(q*.025, fp*.025, 4);
    float thr = mix(.86, .30, cov);
    float m = smoothstep(thr, thr+.14, macro);
    vec2 c = vec2(q.x*.8, q.y*1.25) / .5;
    vec2 wq = vec2(fbm(q*.8, fp*.8, 4), fbm(q*.8 + 5.2, fp*.8, 4));
    float w = worley(c + wq*1.6) * .65 + worley(c*2.3 + wq*2.5 + 3.) * .35;
    float puff = 1. - smoothstep(.08, .85, w);
    float det = fbm(q*5.0, fp*5.0, 5);
    float fpp = smoothstep(.12, .7, fp); // far away the cells blur into a sheet
    puff = mix(puff, .45, fpp);
    return clamp((m * puff * 1.5 - (1. - det) * .55) * 1.2, 0., 1.);
  } else { // low: cumulus / stratocumulus + western bank
    float cov = uCov.z;
    cov = mix(cov, max(cov, uBlock*1.05), smoothstep(30., 150., dist));
    vec2 q = rot(uWind*.5) * p;
    float n = fbm(q*.16, fp*.16, 6);
    float b = fbm(q*.6 + n*2., fp*.6, 4);
    float v = n*.7 + b*.3;
    float thr = mix(.80, .20, cov);
    float d = smoothstep(thr, thr + .28, v);
    float er = fbm(q*2.2 + 9., fp*2.2, 5);
    return clamp(d * 1.1 - (1. - er) * .55 * (1. - d*.6), 0., 1.);
  }
}
vec3 layerH(int L){ return L == 0 ? vec3(9.0, 1.0, 1.0) : L == 1 ? vec3(4.5, .45, 7.0) : vec3(1.4, .6, 18.0); } // alt, thickness, tau scale

vec3 cloudShade(int L, vec3 P, vec3 rd, float t, float pixA, out float alpha){
  vec3 lh = layerH(L);
  vec3 up = normalize(P);
  float cosv = max(dot(up, rd), .015);
  float fp = t * pixA / cosv;              // pixel footprint in km on the layer
  vec2 xz = P.xz;
  float d = dens(L, xz, fp, t);
  if (d < .003){ alpha = 0.; return vec3(0.); }
  float tauV = d * lh.z * min(1./cosv, 12.);
  alpha = 1. - exp(-tauV);
  vec3 sun = uSunC;
  float mu = dot(up, sun);
  vec2 sh = normalize(sun.xz + 1e-5);
  // light path through the deck toward the sun
  float d1 = dens(L, xz + sh*lh.y*1.2, fp*1.5, t), d2 = dens(L, xz + sh*lh.y*3.5, fp*2., t);
  float side = (d1*.6 + d2*.4);
  float above = clamp(mu * 6., 0., 1.);      // sun above the deck -> bases in shadow
  float tauS = lh.z * (side*.55*(1.-above) + d*above*1.2);
  float shadow = exp(-tauS) ;
  float ms = .35 * exp(-tauS*.25);          // multiple scattering keeps cores glowing
  vec3 Ts = sunT(P + up*lh.y*.5, sun);
  float lightIn = L == 2 ? 1. - .55*uBlock : 1. - .9*uBlock*uBlock;
  float cs = dot(rd, sun);
  float ph = mix(phHG(cs, .65), phHG(cs, -.1), .45) ;
  float fwd = mix(1., .35, clamp(tauV*.25, 0., 1.)); // thick cores block the forward lobe
  vec3 direct = ESUN * Ts * lightIn * (ph*fwd*4.*PI*.12 + .05) * (shadow + ms) ;
  // ambient: blue skylight from above + warm horizon light
  vec3 hA = sunT(P + up*2.5, sun), hB = sunT(P + up*12., sun);
  float skyLit = dot(hA, vec3(.25,.45,.3))*.75 + dot(hB, vec3(.25,.45,.3))*.25;
  vec3 amb = ESUN * (vec3(.007,.013,.028) * (skyLit + .012) + .005*hA*vec3(1.,.75,.65));
  amb *= mix(1., .55, d);
  // once the deck is in Earth's shadow it is lit only by the dim twilight sky: let it sit just below the sky, not glow
  amb *= mix(L == 0 ? .6 : .8, 1., clamp(dot(Ts, vec3(.33)) * 25., 0., 1.));
  // internal texture: thin edges glow (silver lining), thick cores go darker when back-lit
  float tex = L == 0 ? (.8 + .4*fbm(xz*.08 + 3., fp*.08, 4)) : (.55 + .9*fbm(xz*(L == 1 ? 5. : 1.3) + 17., fp*(L == 1 ? 5. : 1.3), 5));
  float rim = (1. - smoothstep(.0, .55, d)) * smoothstep(.2, 1., cs) * 2.5;
  return (direct * (tex + rim) + amb * mix(1., tex, .6)) * (L == 0 ? 1.15 : 1.);
}

// radiance of the sky + clouds along a ray from camera
vec3 skyRay(vec3 ro, vec3 rd, float pixA, bool full, out vec3 Tout){
  Acc A; A.L = vec3(0.); A.T = vec3(1.);
  float cs = dot(rd, uSun);
  vec2 top = sph(ro, rd, RT);
  float tEnd = top.y;
  float tc[3]; tc[2] = sph(ro, rd, R0 + 1.4).y; tc[1] = sph(ro, rd, R0 + 4.5).y; tc[0] = sph(ro, rd, R0 + 9.).y;
  int ns = full ? 7 : 4;
  float prev = 0.;
  for (int k = 2; k >= 0; k--){
    float tk = tc[k];
    seg(A, ro, rd, prev, tk, ns, cs);
    prev = tk;
    float cov = k == 0 ? uCov.x : k == 1 ? uCov.y : max(uCov.z, uBlock);
    if (cov > .02 && tk < 650.){
      float al; vec3 c = cloudShade(k, ro + rd*tk, rd, tk, pixA, al);
      float fade = 1. - smoothstep(380., 640., tk);
      al *= fade;
      A.L += A.T * c * al; A.T *= 1. - al;
    }
  }
  seg(A, ro, rd, prev, tEnd, full ? 5 : 3, cs);
  Tout = A.T;
  return A.L;
}

// fraction of sunlight that gets through the clouds along the sun's line of sight
float cloudTowardSun(vec3 ro, vec3 rd){
  float T = 1.;
  for (int k = 2; k >= 0; k--){
    float cov = k == 0 ? uCov.x : k == 1 ? uCov.y : max(uCov.z, uBlock);
    if (cov < .02) continue;
    float a = R0 + layerH(k).x;
    float t = sph(ro, rd, a).y;
    vec3 P = ro + rd*t;
    float cosv = max(dot(normalize(P), rd), .015);
    float d = dens(k, P.xz, t*.004/cosv, t);
    T *= exp(-d * layerH(k).z * min(1./cosv, 12.) * (1. - smoothstep(380., 640., t)));
  }
  return T;
}

// --- foreground: pier silhouette ---
float pierHit(vec3 ro, vec3 rd, out float tp){
  // local metres, camera at origin; deck from z=-6 to -420, x in [-24,-19], deck top y = +1.2 (above eye-water: eye at +2.0 over water)
  tp = 1e9; float hit = 0.;
  vec3 bmin = vec3(-24., 0.4 - 2.0 + 1.6, -420.), bmax = vec3(-19., 1.25 - 2.0 + 1.6, -6.);
  vec3 inv = 1./rd; vec3 t0 = (bmin - ro)*inv, t1 = (bmax - ro)*inv;
  vec3 tn = min(t0,t1), tf = max(t0,t1); float a = max(max(tn.x,tn.y),tn.z), b = min(min(tf.x,tf.y),tf.z);
  if (b > max(a,0.)){ tp = a; hit = 1.; }
  // pilings (two rows) and railing posts in the planes x=-23.6 / -19.4
  for (int k = 0; k < 2; k++){
    float px = k == 0 ? -19.4 : -23.6;
    float t = (px - ro.x) / rd.x; if (t <= 0. || t > tp) continue;
    vec3 q = ro + rd*t;
    if (q.z < -420. || q.z > -6.) continue;
    float fz = abs(fract(q.z/6.) - .5)*6.;
    float w = .22 + t*.0012;
    if (q.y < bmin.y && q.y > -2. && fz < w){ tp = t; hit = 1.; }
    float fr = abs(fract(q.z/3.) - .5)*3.;
    if (q.y > bmax.y && q.y < bmax.y + 1.05 && (fr < .07 + t*.0006 || abs(q.y - (bmax.y+1.)) < .06 + t*.0005 || abs(q.y - (bmax.y+.5)) < .03 + t*.0004)){ tp = t; hit = 1.; }
  }
  return hit;
}

vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - .5*uRes) / uRes.y;
  float th = tan(uFov*.5);
  vec3 rd = normalize(vec3(uv.x*2.*th, uv.y*2.*th, -1.));
  float cp = cos(uPitch), sp = sin(uPitch);
  rd = vec3(rd.x, rd.y*cp + rd.z*(-sp)*-1.*-1., 0.);
  { vec3 d0 = normalize(vec3(uv.x*2.*th, uv.y*2.*th, -1.)); rd = normalize(vec3(d0.x, d0.y*cp - d0.z*sp, d0.y*sp + d0.z*cp)); }
  float pixA = 2.*th / uRes.y / uPixScale;
  BMe = max(uAod, .01) / HM; BMs = BMe * .9;
  vec3 ro = vec3(0., R0 + uCamH, 0.);
  vec3 col; vec3 T;
  float sunVis = cloudTowardSun(ro, uSunA);
  vec3 sunAtm; { vec3 tmp; skyRay(ro, uSunA, .004, false, tmp); sunAtm = sunT(ro, uSunA); }

  // horizon geometry
  float dip = -sqrt(2.*uCamH/R0);
  float elevR = asin(clamp(rd.y, -1., 1.));
  // distant shoreline / hills profile in azimuth (radians above horizon)
  float az = atan(rd.x, -rd.z);
  float prof = -1.;
  if (uShore > 0.){
    float n = fbm(vec2(az*40. + uSeed.x, 3.), .0, 5);
    float mask = smoothstep(.15, .45, fbm(vec2(az*3. + uSeed.y, 9.), 0., 3));
    prof = dip + uShore * (.25 + .9*n) * mask * .0175 - .0008;
  }
  if (uHills > 0.){
    float n = fbm(vec2(az*9. + uSeed.x, 1.), 0., 6);
    prof = max(prof, dip + (.004 + n*.022) * uHills);
  }

  float tP; float pier = uPier > 0. ? pierHit(vec3(0.,0.,0.), rd, tP) : 0.;

  if (pier > .5){
    vec3 Tt; vec3 sk = skyRay(ro, normalize(vec3(rd.x, .02, rd.z)), pixA, false, Tt);
    col = sk * .03 + vec3(.0006,.0005,.0008);
  } else if (elevR > prof && elevR > dip + .0002){
    col = skyRay(ro, rd, pixA, uLQ < .5, T);
    // sun disc (limb darkened, flattened by refraction near the horizon)
    vec3 sa = uSunA;
    float sel = asin(sa.y);
    vec3 dd = rd - sa;
    float sq = 1. + .25*smoothstep(.03, 0., sel);
    float ang = length(vec2(dot(dd, normalize(cross(sa, vec3(0,1,0)))), dot(dd, vec3(0,1,0))*sq));
    float disc = 1. - smoothstep(.0044, .0049, ang);
    float limb = .45 + .55*sqrt(max(0., 1. - (ang/.0047)*(ang/.0047)));
    col += T * disc * limb * ESUN * 9000.;
    // sun dogs (parhelia) ~22° either side of a low sun, in thin ice cloud
    if (uDog > .01){
      float se = asin(clamp(sa.y,-1.,1.));
      float daz = atan(rd.x, -rd.z) - atan(sa.x, -sa.z);
      float off = .3840 / max(cos(se), .5);
      float dy = elevR - se;
      vec3 pd = vec3(0.);
      for (int sgn = -1; sgn <= 1; sgn += 2){
        float x = abs(daz) - off;
        vec3 sh = vec3(-.006, 0., .007);
        vec3 g = exp(-pow((vec3(x) - sh)/vec3(.007,.009,.016), vec3(2.)) - pow(dy/.016, 2.));
        g += exp(-pow(x/.05, 2.) * 1. - pow(dy/.006, 2.)) * .15 * step(0., x); // faint tail away from the sun
        pd = max(pd, g);
      }
      col += pd * uDog * T * ESUN * sunAtm * sunVis * .18 * smoothstep(-.01, .02, sa.y);
    }
  } else if (uWater > .5 && elevR <= dip + .0002){
    // ocean
    float tW = uCamH*1000. / max(-rd.y + (-dip)*.0, 1e-4) ; // metres (flat approx)
    vec3 pw = rd * tW;
    float fpW = tW * pixA / max(-rd.y, .002);
    vec2 wp = pw.xz;
    // wave slope field (metres): long swell + chop, band-limited
    float e = .15;
    e = .04;
    vec2 ws = vec2(.35, 1.4);
    float h0 = fbm(wp*ws, fpW*ws.y, 7);
    float hx = fbm((wp+vec2(e,0.))*ws, fpW*ws.y, 7);
    float hz = fbm((wp+vec2(0.,e))*ws, fpW*ws.y, 7);
    float amp = .07;
    vec3 n = normalize(vec3(-(hx-h0)/e*amp, 1., -(hz-h0)/e*amp*.6));
    float far = smoothstep(150., 2500., tW);
    // ripples that survive at distance: anchored to world x and inverse distance (perspective-compressed streaks)
    vec2 rq = vec2(wp.x / tW * 55. + uSeed.x, 900. / tW + uSeed.y);
    float fq = max(fwidth(rq.x), fwidth(rq.y)) * 1.5;
    float rp = fbm(rq, fq, 5) - .5;
    float rp2 = fbm(rq * vec2(3., 2.7) + 11., fq*3., 4) - .5;
    n = normalize(n + vec3(rp2*.03, 0., (rp*.11 + rp2*.05)) * (.4 + .6*far));
    vec3 rr = reflect(rd, n); rr.y = max(rr.y, .002); rr = normalize(rr);
    float tPr; float pr = uPier > 0. ? pierHit(pw*vec3(1,0,1) + vec3(0,-2.0+.0,0)*0. + vec3(0,-2.,0)*-0., rr, tPr) : 0.;
    vec3 Tr; vec3 refl = skyRay(ro, rr, pixA*2., false, Tr);
    // reflected sun: microfacet glitter
    vec3 sa = uSunA;
    float sunUp = smoothstep(-.006, .004, sa.y);
    vec3 hv = normalize(-rd + sa);
    float nh = max(dot(n, hv), 0.);
    float m = .045 + .05*far;
    float c2 = max(nh*nh, 1e-3); float D = min(exp((c2-1.)/(c2*m*m)) / (PI*m*m*c2*c2), 400.);
    float cosI = max(dot(-rd, n), .01);
    float F = .02 + .98*pow(1.-cosI, 5.);
    float Fs = .02 + .98*pow(1.-max(dot(-rd, hv),0.), 5.);
    vec3 glit = sunUp > 0. ? ESUN * sunT(ro, sa) * sunVis * sunUp * D * Fs / (4.*cosI) * .9 : vec3(0.);
    if (pr > .5) { refl = refl*.03; glit *= 0.; }
    vec3 body = vec3(.002,.006,.008) * (ESUN * .02) * (sunT(ro + vec3(0,20,0), uSun).g*.8 + .05);
    col = refl * F * 1.0 + glit + body * (1.-F);
    // aerial perspective over the water
    vec3 Ta; vec3 hzS = skyRay(ro, normalize(vec3(rd.x, .001, rd.z)), pixA, false, Ta);
    float fog = 1. - exp(-tW*.001 * (BMe*1.3 + BR.g*1.) );
    col = mix(col, hzS * .9, clamp(fog, 0., 1.));
    col = max(col, vec3(0.)); if (any(isnan(col))) col = hzS*.3;
  } else {
    // land / hills / shoreline silhouettes with aerial perspective
    vec3 Ta; vec3 hzS = skyRay(ro, normalize(vec3(rd.x, max(prof, dip)+.002, rd.z)), pixA, false, Ta);
    float depth = uHills > 0. ? clamp((elevR - dip) / .03 + .2, 0., 1.) : .55;
    vec3 land = vec3(.0012,.0011,.0014) * (ESUN*.05);
    col = mix(land, hzS*.55, depth * (.35 + .5*clamp(uAod*3.,0.,1.)));
    if (uWater > .5 && elevR < dip) col = mix(col, hzS * .15, .5);
  }

  // lens glare around the sun (scaled by how much sun gets through cloud)
  vec3 sa = uSunA;
  float ca = acos(clamp(dot(rd, sa), -1., 1.));
  vec3 sunRad = ESUN * sunAtm * sunVis * smoothstep(-.012, .003, sa.y);
  col += sunRad * (2.5e-3 / (1. + pow(ca/.004, 2.)) + 4e-4 / (1. + pow(ca/.05, 2.)) + 6e-5*exp(-ca*4.));

  if (uMeter > 1.5){ o = vec4(sqrt(clamp(col * uExpo / 4., 0., 1.)), 1.); return; }
  if (uMeter > .5){ float L = max(max(col.r, max(col.g, col.b)) * .8 + dot(col, vec3(.2126,.7152,.0722)) * .2, 1e-6); o = vec4(clamp((log2(L) + 16.) / 24., 0., 1.), 0., 0., 1.); return; }
  col *= uExpo;
  { float lm = dot(col, vec3(.2126,.7152,.0722)); col = max(mix(vec3(lm), col, 1.3), 0.); }  // film-like colour separation
  // twilight colour response (calibrated against reference sunset photos): long-path warm light reads orange-red/pink
  // on camera rather than yellow, so pull green out of warm tones as the sun sinks
  { float warm = clamp((col.r - col.b) / (col.r + 1e-4), 0., 1.);
    col.g *= 1. - .28 * uTwi * warm;
    col.b *= 1. + .25 * uTwi * warm * smoothstep(.0, .5, rd.y); }
  // filmic response: blend of per-channel ACES (natural highlight roll-off) and hue-preserving ACES (keeps reds red
  // instead of skewing to yellow when bright)
  float mx = max(col.r, max(col.g, col.b));
  vec3 hp = mx > 1e-5 ? col * (aces(vec3(mx)).r / mx) : col;
  col = mix(aces(col), hp, .55);
  float l = dot(col, vec3(.2126,.7152,.0722));
  col = mix(vec3(l), col, 1.1);
  col = pow(clamp(col, 0., 1.), vec3(1./2.2));
  // vignette + grain
  vec2 q = frag / uRes;
  col *= .78 + .22*pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y), .25);
  float gr = h12(frag + fract(uGrainT)*917.) - .5;
  col += gr * .018;
  o = vec4(col, 1.);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function setup(canvas) {
    if (canvas._pr !== undefined) return canvas._pr;
    let st = null;
    try {
      const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
      if (gl) {
        const pr = gl.createProgram();
        gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const U = {}; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(pr, i); U[a.name] = gl.getUniformLocation(pr, a.name); }
        st = { gl, pr, U };
      }
    } catch (e) { console.warn("Photoreal renderer unavailable:", e); st = null; }
    canvas._pr = st; return st;
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  // refraction (Bennett/Saemundsson), degrees
  const refr = e => e < -1.6 ? 0 : 1.02 / Math.tan((e + 10.3 / (e + 5.11)) * Math.PI / 180) / 60;

  // params: { elev (deg geometric), sunAzOff (deg), high, mid, low (0..1), block, aod, rh, water, pier, shore, hills, camH (km), seed, wind, lq }
  function render(canvas, P) {
    const st = setup(canvas); if (!st) return false;
    const { gl, pr, U } = st;
    const dpr = P.w ? 1 : Math.min(window.devicePixelRatio || 1, 2), sc = P.lq ? 0.42 : (P.scale || 1);
    const W = P.w || canvas.clientWidth || 600, H = P.h || canvas.clientHeight || 340;
    const w = Math.max(64, Math.round(W * dpr * sc)), h = Math.max(48, Math.round(H * dpr * sc));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h); gl.useProgram(pr);
    const d2r = Math.PI / 180, e = P.elev * d2r, ea = (P.elev + refr(P.elev)) * d2r, az = (P.sunAzOff || 0) * d2r;
    const dir = (el) => [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
    gl.uniform2f(U.uRes, w, h);
    gl.uniform3fv(U.uSun, dir(e)); gl.uniform3fv(U.uSunA, dir(ea));
    // grazing sunlight that reaches high cloud after sunset is bent ~0.5° on each half of its path through the low atmosphere
    const lift = 0.75 * clamp((-0.8 - P.elev) / 2);
    gl.uniform3fv(U.uSunC, dir(e + lift * d2r));
    gl.uniform3f(U.uCov, P.high, P.mid, P.low);
    gl.uniform1f(U.uBlock, P.block); gl.uniform1f(U.uAod, P.aod); gl.uniform1f(U.uRH, P.rh);

    gl.uniform1f(U.uWater, P.water ? 1 : 0); gl.uniform1f(U.uPier, P.pier ? 1 : 0); gl.uniform1f(U.uShore, P.shore || 0); gl.uniform1f(U.uHills, P.hills || 0);
    gl.uniform1f(U.uCamH, P.camH || 0.002);
    const aspect = W / H, vfov = aspect < 1 ? 62 : aspect < 1.5 ? 50 : 40;
    gl.uniform1f(U.uFov, vfov * d2r); gl.uniform1f(U.uPitch, (vfov * 0.17) * d2r);
    gl.uniform2f(U.uSeed, P.seed * 977 % 500, P.seed * 613 % 500); gl.uniform1f(U.uWind, P.wind || 0);
    gl.uniform1f(U.uLQ, P.lq ? 1 : 0); gl.uniform1f(U.uDog, P.dog || 0); gl.uniform1f(U.uPixScale, 1);
    gl.uniform1f(U.uTwi, Math.max(0, Math.min(1, (1.5 - P.elev) / 3)) * Math.max(0, Math.min(1, (P.elev + 8) / 3))); gl.uniform1f(U.uGrainT, P.grain || 0.37);
    gl.uniform1f(U.uMeter, 0);
    const ex = P.expo != null ? P.expo : meter(gl, U, w, h, P);
    gl.viewport(0, 0, w, h); gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uMeter, 0); gl.uniform1f(U.uExpo, ex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    render.lastExpo = ex;
    return true;
  }
  // in-camera metering: tiny HDR pass -> expose so the bright part of the sky (90th percentile) sits just under white,
  // the way a photographer exposes a sunset (protect highlights, keep saturation). Blended with a twilight curve.
  const mcache = {};
  function meter(gl, U, w, h, P) {
    const key = [P.elev, P.high, P.mid, P.low, P.block, P.aod, P.seed, P.water, P.pier].map(v => typeof v === "number" ? v.toFixed(3) : v).join("|") + "|" + (w / h).toFixed(2);
    if (mcache[key]) return mcache[key];
    const mw = 64, mh = Math.max(24, Math.round(64 * h / w));
    gl.viewport(0, 0, mw, mh); gl.uniform2f(U.uRes, mw, mh); gl.uniform1f(U.uMeter, 1); gl.uniform1f(U.uLQ, 0); gl.uniform1f(U.uPixScale, w / mw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(mw * mh * 4); gl.readPixels(0, 0, mw, mh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.uniform1f(U.uLQ, P.lq ? 1 : 0); gl.uniform1f(U.uPixScale, 1);
    const L = []; for (let i = 0; i < mw * mh; i++) L.push(Math.pow(2, px[i * 4] / 255 * 24 - 16));
    L.sort((a, b) => a - b);
    const p90 = L[Math.floor(L.length * 0.97)], p50 = L[Math.floor(L.length * 0.5)];
    meter.dbg = [p90, p50, px[0], px[1], px[(mw*mh-1)*4]];
    const p99 = L[Math.floor(L.length * 0.995)];
    let ex = Math.min(0.8 / Math.max(p90, 1e-5), 1.5 / Math.max(p99, 1e-5));
    ex = Math.min(ex, 0.22 / Math.max(p50, 1e-5) * 3.5);     // don't lift the mid-tones into daylight
    const curve = autoExpo(P);
    ex = Math.max(curve * 0.7, Math.min(curve * 10, ex));
    const keys = Object.keys(mcache); if (keys.length > 400) delete mcache[keys[0]];
    return (mcache[key] = ex);
  }
  // camera exposure that a photographer would pick: meter the sky, keep sunsets slightly under-exposed for saturation
  function autoExpo(P) {
    const T = [[8, 0.2], [6, 0.22], [3, 0.28], [0.5, 0.42], [-1.5, 0.85], [-3.5, 3], [-6, 9], [-9, 20]], e = P.elev;
    if (e >= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) if (e >= T[i][0]) { const [x0, y0] = T[i - 1], [x1, y1] = T[i], f = (e - x1) / (x0 - x1); return Math.exp(Math.log(y1) + (Math.log(y0) - Math.log(y1)) * f); }
    return T[T.length - 1][1];
  }
  g.Photoreal = { render, meter, setup, autoExpo, hash, supported: () => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; } } };
})(window);
