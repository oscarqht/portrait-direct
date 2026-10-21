// Tapered cylindrical strands adapted from Alpha Bro Pets / 3d-gpu-fur-simulation.
// Curved fleece with body-driven spring lag; no GPU simulation or shell passes.
import { COMMON_HAIR_BSDF_GLSL } from "./fur-lighting";

export const STRAND_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aRootPos;
  attribute vec3 aRootNormal;
  attribute vec3 aGroomDir;
  attribute vec3 aClumpOffset;
  attribute float aStrandSeed;
  attribute float aMaskValue;

  uniform float uFurLength;
  uniform float uFurDensity;
  uniform float uStrandWidthBoost;
  uniform float uClumping;
  uniform float uCurliness;
  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3 uWebGLInertia;
  uniform vec3 uAngularLag;
  uniform vec3 uStretchLag;

  varying float vHeight;
  varying float vRibbonU;
  varying float vStrandSeed;
  varying vec3 vWorldPos;
  varying vec3 vSurfNormal;
  varying vec3 vHairTangent;
  varying float vCombMemory;

  void main() {
    float h = position.y; // [0..1] along the eight-segment soft curve
    vHeight = h;
    vRibbonU = position.x; // [-1..1] across ribbon width
    vStrandSeed = aStrandSeed;

    // Density culling in vertex shader (collapse inactive strands to zero area)
    if (aMaskValue < 0.05) {
      gl_Position = vec4(2.0, 2.0, 2.0, 0.0);
      return;
    }

    vec3 N = normalize(aRootNormal);
    vec3 G = normalize(aGroomDir);
    vec3 sideVec = normalize(cross(N, G) + vec3(1e-4, 0.0, 0.0));

    // Local inertia comes from the actual body translation, rotation and squash.
    // Opposing root offsets give the left/right sides a natural trailing response.
    vec3 inertia = uWebGLInertia + cross(uAngularLag, aRootPos) + uStretchLag * aRootPos;
    inertia -= N * min(0.0, dot(inertia, N));
    inertia *= min(1.0, 0.85 / max(0.0001, length(inertia)));
    vCombMemory = 0.0;

    float lenVariation = 0.82 + 0.36 * fract(aStrandSeed * 17.31);
    float totalLen = uFurLength * aMaskValue * lenVariation * 1.15;

    // Smooth cantilever bend along the hair shaft
    float bend = pow(h, 1.55);
    float smoothEnv = h * h * (3.0 - 2.0 * h);

    vec3 windWave = vec3(
      sin(aRootPos.y * 4.4 + uTime * 2.7 + aStrandSeed * 3.14) * 0.08,
      cos(aRootPos.x * 3.9 + uTime * 2.2) * 0.04,
      cos(aRootPos.z * 4.1 - uTime * 2.5 + aStrandSeed * 3.14) * 0.08
    ) * uWindStrength;

    // Spatially coherent lock phase so neighboring strands wave & curl together smoothly
    vec3 tuftAnchor = aRootPos + aClumpOffset;
    float coherentPhase = dot(tuftAnchor, vec3(5.4, 6.2, 5.0)) + (fract(aStrandSeed * 43.17) - 0.5) * 0.65;
    float curlFreq = mix(3.2, 8.2, uCurliness);
    float spiralAngle = h * curlFreq + coherentPhase;

    // Zero offset at root (h=0) via smoothEnv, building into soft S-waves & ringlets
    float curlAmp = uCurliness * totalLen * 0.34 * smoothEnv;
    vec3 curlOffset =
      sideVec * (sin(spiralAngle) - sin(coherentPhase)) * curlAmp +
      G * (cos(spiralAngle) - cos(coherentPhase)) * (curlAmp * 0.65);

    // Exact analytical derivative d(curlOffset)/dh for smooth tangent & specular continuity
    vec3 curlTangent =
      (sideVec * cos(spiralAngle) - G * sin(spiralAngle) * 0.65) * (curlAmp * curlFreq);

    vec3 clumpPull = aClumpOffset * (smoothEnv * uClumping * totalLen * 0.68);

    vec3 spineLocal =
      aRootPos +
      N * (h * totalLen) +
      G * (bend * totalLen * 0.62) +
      clumpPull +
      curlOffset +
      (inertia * 1.05 + windWave + vec3(0.0, -0.24, 0.0)) * bend * totalLen;

    vec3 localTangent = normalize(
      N * totalLen +
      G * (1.55 * pow(max(0.05, h), 0.55) * totalLen * 0.62) +
      clumpPull * 1.15 +
      curlTangent +
      (inertia * 1.05 + windWave + vec3(0.0, -0.24, 0.0)) * totalLen * 1.55 * pow(max(0.05, h), 0.55)
    );

    vec3 worldSpine = (modelMatrix * vec4(spineLocal, 1.0)).xyz;
    vec3 worldTangent = normalize(mat3(modelMatrix) * localTangent);
    vSurfNormal = normalize(mat3(modelMatrix) * N);
    vHairTangent = worldTangent;

    // Camera-facing cylindrical ribbon billboarding (eliminates twisted/flat polygon kinks!)
    vec3 viewDir = normalize(cameraPosition - worldSpine);
    vec3 billboardRight = normalize(cross(worldTangent, viewDir) + vec3(1e-5, 0.0, 0.0));

    // Taper strand ribbon width smoothly from root to fine tip (scaled by modelMatrix scale)
    // Quality-dependent width keeps the fine coat continuous at lower densities.
    float modelScale = length(modelMatrix[0].xyz);
    float modeWidthBoost = uStrandWidthBoost;
    float baseWidth = 0.0033 * modeWidthBoost * (0.82 + 0.38 * (1.0 - uFurDensity)) * modelScale;
    float width = baseWidth * (1.0 - pow(h, 1.35));

    vec3 finalWorld = worldSpine + billboardRight * (position.x * width);
    vWorldPos = finalWorld;

    gl_Position = projectionMatrix * viewMatrix * vec4(finalWorld, 1.0);
  }
`;

export const STRAND_FRAGMENT_SHADER = /* glsl */ `
  ${COMMON_HAIR_BSDF_GLSL}

  varying float vHeight;
  varying float vRibbonU;
  varying float vStrandSeed;
  varying vec3 vWorldPos;
  varying vec3 vSurfNormal;
  varying vec3 vHairTangent;
  varying float vCombMemory;

  void main() {
    vec3 color = evaluatePhysicalHairShading(
      vWorldPos,
      vSurfNormal,
      vHairTangent,
      vHeight,
      vStrandSeed,
      vCombMemory
    );

    // Cylindrical cross-strand shading across the geometrically tapered 3D ribbon
    // Fine geometric taper avoids order-dependent alpha/depth holes between fibers.
    float radialDist = abs(vRibbonU);
    float cylinderRoundness = sqrt(max(0.18, 1.0 - radialDist * radialDist * 0.82));
    color *= (0.82 + 0.24 * cylinderRoundness);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
