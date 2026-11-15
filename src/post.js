// The film look: HDR render with multisampling, soft bloom on the sun, lamps and lit windows,
// filmic tone mapping, then a grade pass (contrast, a little warmth, vignette, grain and a
// speed blur at the edges of the frame when the car is flying).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Ambient occlusion from solid geometry only: markers, beams, glass, sprites and the sky are
// see-through or flat and would leave dark outlines around themselves.
class SolidAOPass extends GTAOPass {
  _overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const skip = o.isPoints || o.isLine || o.isSprite || o.userData.noAO
        || (m && (m.transparent || m.depthWrite === false || m.isShadowMaterial || m.isShaderMaterial));
      if (skip && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) { o.visible = false; cache.push(o); }
    });
  }
}

const GradeShader = {
  name: 'GradeShader',
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBlur: { value: 0 }, uNight: { value: 0 }, uNeutral: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uCenter: { value: new THREE.Vector2(0.5, 0.5) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uBlur; uniform float uNight; uniform float uNeutral; uniform vec2 uTexel; uniform vec2 uCenter;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = (vUv - 0.5);
      float edge = dot(d, d);
      vec3 c;
      if (uBlur < 0.003) c = texture2D(tDiffuse, vUv).rgb;
      else {
        // Speed blur as a camera sees it: everything streaks away from the point the car is
        // heading to. That point and the car stay sharp, the streaks grow toward the edges of
        // the frame, and each pixel starts its samples at a random offset so the streak is
        // smooth instead of a stack of ghost images.
        vec2 dc = vUv - uCenter;
        float r = length(dc * vec2(uTexel.y / uTexel.x, 1.0));
        float amt = uBlur * smoothstep(0.1, 0.8, r);
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); // even dither, no sparkle
        vec3 sum = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 16; i++) {
          float t = (float(i) + jit) / 16.0;
          float w = 1.0 - t * 0.65;                       // the sharp image leads, the trail fades
          sum += texture2D(tDiffuse, vUv - dc * amt * t).rgb * w;
          wsum += w;
        }
        c = sum / wsum;
        // the lens pulls the colors apart a little at the very edge when flying
        float ca = amt * 0.02;
        c.r = mix(c.r, texture2D(tDiffuse, vUv - dc * (amt * 0.4 + ca)).r, 0.3);
        c.b = mix(c.b, texture2D(tDiffuse, vUv - dc * (amt * 0.4 - ca)).b, 0.3);
      }
      // subtle sharpening: push each pixel away from the average of its four neighbors
      vec3 around = (texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
      c = clamp(c + (c - around) * 0.45 * (1.0 - min(1.0, uBlur * 4.0)), 0.0, 1.0);
      // the film grade is for the block city; over the Google photos (uNeutral) colors stay as shot
      float look = 1.0 - uNeutral;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.0 + 0.1 * look);                                 // saturation
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28 * look);                      // gentle S curve
      c *= mix(vec3(1.0), mix(vec3(1.03, 1.0, 0.96), vec3(0.94, 0.98, 1.06), uNight), look); // warm days, cool nights
      c *= 1.0 - smoothstep(0.2, 0.78, edge) * mix(0.42, 0.2, uNeutral);    // vignette, slight over photos
      c += (hash(vUv * 900.0 + uTime) - 0.5) * 0.018 * look;                // grain
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(ctx) {
  const { renderer, scene, camera } = ctx;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // On integrated graphics there is no multisampling on the HDR target (it was the single most
  // expensive thing in the frame): SMAA after tone mapping smooths the edges instead. A
  // discrete card gets both, and ambient occlusion on top.
  const Q = ctx.quality;
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let ao = null;
  if (Q.ao) {
    ao = new SolidAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.2, thickness: 1.4, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(ao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.7, 1.0);
  bloom.enabled = Q.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  smaa.enabled = Q.smaa;
  composer.addPass(smaa);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  let blur = 0, neutral = 0, bloomOn = Q.bloom;
  const ahead = new THREE.Vector3(), center = new THREE.Vector2(0.5, 0.5);

  return {
    composer, bloom,
    render(dt) {
      const speed = Math.abs(ctx.car.state.speed);
      // nothing at cruising speed, building with speed, and a kick while the boost is held
      const boost = ctx.car.state.boost || 0;
      const want = ctx.state === 'play' && !ctx.reveal?.open ? THREE.MathUtils.clamp((speed - 27) / 30, 0, 1) * (0.13 + 0.09 * boost) : 0;
      blur += (want - blur) * Math.min(1, dt * (want > blur ? 3 : 5));
      grade.uniforms.uBlur.value = blur;
      // the streaks radiate from where the road goes: a point well ahead of the car
      if (blur > 0.003) {
        const s = ctx.car.state;
        ahead.set(s.x - Math.sin(s.heading) * 120, (s.y || 0) + 1.2, s.z - Math.cos(s.heading) * 120).project(camera);
        const ok = ahead.z < 1;
        center.set(ok ? THREE.MathUtils.clamp(ahead.x * 0.5 + 0.5, 0.25, 0.75) : 0.5, ok ? THREE.MathUtils.clamp(ahead.y * 0.5 + 0.5, 0.3, 0.8) : 0.5);
        grade.uniforms.uCenter.value.lerp(center, Math.min(1, dt * 6));
      }
      grade.uniforms.uTime.value = (grade.uniforms.uTime.value + dt) % 10;
      const night = ctx.env ? ctx.env.state.night : 0;
      grade.uniforms.uNight.value = night;
      grade.uniforms.uNeutral.value = neutral;
      renderer.getDrawingBufferSize(size);
      grade.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
      // the photo city already holds its own soft shadows: only a light touch there
      if (ao) ao.blendIntensity = neutral ? 0.55 : 1.0;
      bloom.enabled = bloomOn && !neutral; // bloom would lift the brightest photo pixels
      // the daytime sky and sunlit walls sit well above 1.0 in HDR, so only the sun, chrome
      // glints and lamps should pass the threshold
      const dark = THREE.MathUtils.smoothstep(night, 0.5, 1);
      bloom.strength = 0.14 + dark * 0.45;
      bloom.threshold = 7.0 - dark * 6.0;
      composer.render(dt);
    },
    resize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); },
    // returns true when it changed something
    setAO(on) { if (!ao || ao.enabled === on) return false; ao.enabled = on; return true; },
    get ao() { return ao; },
    setBloom(on) { bloomOn = on; bloom.enabled = on; },
    setNeutral(on) { neutral = on ? 1 : 0; },
  };
}
