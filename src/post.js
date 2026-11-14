// The film look: HDR render with multisampling, soft bloom on the sun, lamps and lit windows,
// filmic tone mapping, then a grade pass (contrast, a little warmth, vignette, grain and a
// speed blur at the edges of the frame when the car is flying).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'GradeShader',
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBlur: { value: 0 }, uNight: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uBlur; uniform float uNight;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = (vUv - 0.5);
      float edge = dot(d, d);
      vec3 c = vec3(0.0);
      vec2 step = d * uBlur * edge * 4.0;
      for (int i = 0; i < 6; i++) c += texture2D(tDiffuse, vUv - step * float(i)).rgb;
      c /= 6.0;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.1);                                  // saturation
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);                  // gentle S curve
      c *= mix(vec3(1.03, 1.0, 0.96), vec3(0.94, 0.98, 1.06), uNight); // warm days, cool nights
      c *= 1.0 - smoothstep(0.18, 0.75, edge) * 0.42;             // vignette
      c += (hash(vUv * 900.0 + uTime) - 0.5) * 0.018;             // grain
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(ctx) {
  const { renderer, scene, camera } = ctx;
  const low = ctx.quality.low;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.7, 1.0);
  bloom.enabled = !low;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  let blur = 0;

  return {
    composer, bloom,
    render(dt) {
      const speed = Math.abs(ctx.car.state.speed);
      const want = ctx.state === 'play' ? THREE.MathUtils.clamp((speed - 30) / 16, 0, 1) * 0.3 : 0;
      blur += (want - blur) * Math.min(1, dt * 4);
      grade.uniforms.uBlur.value = blur;
      grade.uniforms.uTime.value = (grade.uniforms.uTime.value + dt) % 10;
      const night = ctx.env ? ctx.env.state.night : 0;
      grade.uniforms.uNight.value = night;
      // the daytime sky and sunlit walls sit well above 1.0 in HDR, so only the sun, chrome
      // glints and lamps should pass the threshold
      const dark = THREE.MathUtils.smoothstep(night, 0.5, 1);
      bloom.strength = 0.14 + dark * 0.45;
      bloom.threshold = 7.0 - dark * 6.0;
      composer.render(dt);
    },
    resize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); },
    setBloom(on) { bloom.enabled = on; },
  };
}
