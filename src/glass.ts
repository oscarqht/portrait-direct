import * as THREE from 'three';

/**
 * Adapted from oscarqht/glass, FluidGlass.tsx at
 * f10dc9cd915fb1ee190690591141e196c7471a59 (FLUID_GLASS_PRESETS and studio).
 * https://github.com/oscarqht/glass
 *
 * Keep its analytical studio reflections and clear-glass optical settings, but
 * use Three's mesh transmission so every pet silhouette and orbit angle works.
 * The same mesh and optical material are used in preview and all Portrait views.
 */
const CLEAR = { refraction: 1, dispersion: 0.35, reflection: 1, frost: 0, tint: 0, shadow: 0.5 };

// Original FluidGlass studio reflection model. PMREM prefilters these softboxes
// for the physical material; no remote HDR image or other assets are required.
const STUDIO_FRAGMENT = `
  varying vec3 vDirection;
  vec3 studio(vec3 d) {
    vec2 a = vec2(atan(d.x, d.z), d.y);
    float key = (1.0-smoothstep(0.22, 0.42, abs(a.x + 0.62))) * (1.0-smoothstep(0.12, 0.3, abs(a.y - 0.5)));
    float strip = (1.0-smoothstep(0.05, 0.12, abs(a.x - 0.95))) * (1.0-smoothstep(0.35, 0.8, abs(a.y - 0.05)));
    float dome = smoothstep(0.0, 1.0, d.z) * 0.04;
    return vec3(18.0) * key + vec3(8.0) * strip + vec3(dome);
  }
  void main() {
    vec3 d = normalize(vDirection);
    // A pale studio surround keeps tinted glass readable on the light backdrop.
    vec3 surround = mix(vec3(0.32, 0.39, 0.46), vec3(0.95, 1.0, 1.06), d.y * 0.5 + 0.5);
    gl_FragColor = vec4(surround + studio(d), 1.0);
  }
`;

export function createGlassMaterial(color: string, thickness=0.96): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    // Absorption carries the pet color through the glass without an opaque coat.
    color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.72),
    attenuationColor: color,
    attenuationDistance: 1.8,
    transmission: 0.96,
    thickness,
    ior: 1 + 0.5 * CLEAR.refraction,
    dispersion: CLEAR.dispersion,
    roughness: 0.055 + CLEAR.frost,
    metalness: 0,
    clearcoat: CLEAR.reflection,
    clearcoatRoughness: 0.045,
    envMapIntensity: 1,
    transparent: true,
    opacity: 0.92,
  });
}

/** One local reflection environment, shared across frames and optical views. */
export function createGlassEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(10, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: STUDIO_FRAGMENT,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(scene, 0, 0.1, 30, { size: 128 });
  } finally {
    geometry.dispose();
    material.dispose();
    generator.dispose();
  }
}
