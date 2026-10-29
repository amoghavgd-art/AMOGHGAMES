import * as THREE from "three";

export interface CRTShaderOptions {
  curve?: number;
  cornerMask?: number;
  scanCount?: number;
  scanIntensity?: number;
  width?: number;
  height?: number;
}

/**
 * Create a NearestFilter RGBA DataTexture for streaming cartridge frames (320x200 or 128x128).
 */
export function createCrtDataTexture(width = 320, height = 200): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Copy an RGBA byte array (either 320x200x4 or 128x128x4) into a CRT DataTexture.
 * If the incoming frame dimensions differ from the current DataTexture, a new DataTexture is allocated.
 */
export function updateCrtDataTexture(
  tex: THREE.DataTexture,
  rgba: Uint8Array | Uint8ClampedArray
): THREE.DataTexture {
  let targetW = tex.image.width;
  let targetH = tex.image.height;

  if (rgba.byteLength === 320 * 200 * 4) {
    targetW = 320;
    targetH = 200;
  } else if (rgba.byteLength === 128 * 128 * 4) {
    targetW = 128;
    targetH = 128;
  } else if (rgba.byteLength === 160 * 100 * 4) {
    targetW = 160;
    targetH = 100;
  }

  let outTex = tex;
  if (outTex.image.width !== targetW || outTex.image.height !== targetH) {
    outTex.dispose();
    outTex = createCrtDataTexture(targetW, targetH);
  }

  const dst = outTex.image.data as Uint8Array;
  const src =
    rgba instanceof Uint8Array
      ? rgba
      : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  dst.set(src.subarray(0, dst.length));
  outTex.needsUpdate = true;
  return outTex;
}

/**
 * Compute the average RGB color of an RGBA buffer or ImageData (sampled at a stride for speed)
 * so the point light in front of the screen dynamically tints the room.
 */
export function computeFrameAverageColor(
  rgba: Uint8Array | Uint8ClampedArray,
  target = new THREE.Color()
): THREE.Color {
  const len = rgba.length;
  if (len < 4) return target.setRGB(1, 0.64, 0);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const step = Math.max(4, Math.floor(len / (4 * 256)) * 4);
  for (let i = 0; i < len; i += step) {
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    count++;
  }
  if (count === 0) return target;
  // Boost saturation/brightness slightly so dark game backgrounds still emit a warm glow
  const nr = Math.min(1, (r / (count * 255)) * 1.4 + 0.08);
  const ng = Math.min(1, (g / (count * 255)) * 1.4 + 0.05);
  const nb = Math.min(1, (b / (count * 255)) * 1.4 + 0.06);
  return target.setRGB(nr, ng, nb);
}

/**
 * Custom CRT ShaderMaterial ported from mocks/playglow/index.html & BRIEF.md §6–7:
 * - Barrel distortion (divisors 10.0 / 9.0)
 * - Scanlines at 100 rows (1 dark line at 0.72 every 2 rows of 320x200)
 * - 3% soft edge falloff + anti-aliased bezel mask eliminating edge streaks
 * - +14% center glow (`1. + .14 * exp(-dot(d, d) * 7.)`) and 1.08 brightness
 * - Power-down collapse (`uPower` 1 -> 0 collapses vertically to a horizontal line then a center dot)
 */
export function makeCRTMaterial(
  initialTex?: THREE.Texture | null,
  opts: CRTShaderOptions = {}
): THREE.ShaderMaterial {
  const tex = initialTex ?? createCrtDataTexture(opts.width ?? 320, opts.height ?? 200);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;

  const uTexObj = { value: tex };
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTex: uTexObj,
      map: uTexObj,
      uTime: { value: 0.0 },
      uCurve: { value: opts.curve ?? 0.09 },
      uCornerMask: { value: opts.cornerMask ?? 0.03 },
      uScanCount: { value: opts.scanCount ?? 100.0 },
      uScanIntensity: { value: opts.scanIntensity ?? 0.28 },
      uRes: { value: new THREE.Vector2(opts.width ?? 160, opts.height ?? 100) },
      uPower: { value: 1.0 },
      uBrightness: { value: 1.08 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uTime;
      uniform float uCurve;
      uniform float uCornerMask;
      uniform float uScanCount;
      uniform float uScanIntensity;
      uniform vec2 uRes;
      uniform float uPower;
      uniform float uBrightness;
      varying vec2 vUv;

      vec2 barrelCurve(vec2 uv, float amt) {
        vec2 c = uv * 2.0 - 1.0;
        float k = amt <= 0.25 ? (amt / 0.09) : amt;
        vec2 o = abs(c.yx) / vec2(10.0, 9.0);
        c += c * (o * o) * k;
        return c * 0.5 + 0.5;
      }

      void main() {
        vec2 uv = barrelCurve(vUv, uCurve);
        vec3 bezelCol = vec3(0.003, 0.002, 0.006);

        // Smooth bezel boundary mask to prevent jagged edge streaks on curved CRT borders
        float boundPad = 0.006;
        vec2 inBounds2 = smoothstep(0.0, boundPad, uv) * smoothstep(1.0, 1.0 - boundPad, uv);
        float inBounds = inBounds2.x * inBounds2.y;
        if (inBounds <= 0.0001) {
          gl_FragColor = vec4(bezelCol, 1.0);
          #include <colorspace_fragment>
          return;
        }

        // Power-down collapse: 1.0 -> 0.35 collapses vertically to a horizontal line;
        // 0.35 -> 0.0 collapses the horizontal line to a glowing center dot.
        if (uPower < 0.999) {
          float vPhase = clamp((uPower - 0.32) / 0.68, 0.0, 1.0);
          float hPhase = clamp(uPower / 0.32, 0.0, 1.0);
          float dy = abs(uv.y - 0.5);
          float dx = abs(uv.x - 0.5);
          float halfH = mix(0.012, 0.5, vPhase * vPhase);
          float halfW = mix(0.018, 0.5, smoothstep(0.0, 1.0, hPhase));

          if (dy > halfH || dx > halfW || uPower <= 0.005) {
            // Subtle center dot afterglow right at collapse
            float dotDist = length((uv - 0.5) * vec2(1.6, 1.0));
            float dotGlow = smoothstep(0.05, 0.0, dotDist) * smoothstep(0.0, 0.25, uPower);
            vec3 offRgb = bezelCol + vec3(1.0, 0.95, 0.91) * dotGlow;
            gl_FragColor = vec4(offRgb, 1.0);
            #include <colorspace_fragment>
            return;
          }

          uv.y = (uv.y - 0.5) / max(0.024, halfH * 2.0) + 0.5;
          uv.x = (uv.x - 0.5) / max(0.036, halfW * 2.0) + 0.5;
        }

        vec3 col = texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb;

        // Horizontal scanlines (matches mocks/playglow/index.html: mix(.72, 1., smoothstep(0., .35, fy) * smoothstep(1., .65, fy)))
        float scanRows = uScanCount > 1.0 ? uScanCount : uRes.y;
        float fy = fract(uv.y * scanRows);
        float scanWave = smoothstep(0.0, 0.35, fy) * smoothstep(1.0, 0.65, fy);
        float scan = mix(1.0 - uScanIntensity, 1.0, scanWave);

        // 3% soft edge falloff + center glow (+14%)
        vec2 edge = smoothstep(0.0, uCornerMask, uv) * smoothstep(1.0, 1.0 - uCornerMask, uv);
        float cornerMask = edge.x * edge.y * inBounds;
        vec2 d = uv - 0.5;
        float centerGlow = 1.0 + 0.14 * exp(-dot(d, d) * 7.0);

        // Boost phosphor line brightness when collapsing during power-down/up
        float collapseBoost = uPower < 0.999 ? (1.0 + (1.0 - uPower) * 1.6) : 1.0;

        vec3 finalRgb = col * scan * cornerMask * centerGlow * uBrightness * collapseBoost
          + vec3(0.004, 0.003, 0.008);

        if (uPower < 0.45) {
          finalRgb = mix(finalRgb, vec3(1.0, 0.95, 0.91), (0.45 - uPower) * 1.8);
        }

        gl_FragColor = vec4(mix(bezelCol, finalRgb, inBounds), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });

  return mat;
}
