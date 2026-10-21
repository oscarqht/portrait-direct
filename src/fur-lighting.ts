// Physical hair lighting adapted from 3d-gpu-fur-simulation/src/furShaders.js.
export const COMMON_HAIR_BSDF_GLSL = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  uniform float uRoughness;
  uniform float uSpecular;
  uniform float uFurDensity;
  uniform vec3 uKeyLightDir;
  uniform vec3 uKeyLightColor;
  uniform float uKeyLightIntensity;
  uniform vec3 uRimLightDir;
  uniform vec3 uRimLightColor;
  uniform float uRimIntensity;
  uniform float uAmbientIntensity;
  uniform vec3 uEnvSkyColor;
  uniform vec3 uEnvGroundColor;
  uniform float uEnvTintStrength;

  // Shift hair tangent along surface normal to model tilted cuticle scales (Marschner 2003)
  vec3 shiftTangent(vec3 T, vec3 N, float shift) {
    return normalize(T + N * shift);
  }

  // Anisotropic Kajiya-Kay / Marschner longitudinal specular lobe
  float hairSpecularLobe(vec3 T, vec3 N, vec3 V, vec3 L, float roughness) {
    vec3 H = normalize(L + V + vec3(1e-6, 1e-6, 1e-6));
    float dotTH = clamp(dot(T, H), -1.0, 1.0);
    float sinTH = sqrt(max(1e-5, 1.0 - dotTH * dotTH));
    float hemiVis = smoothstep(-0.25, 0.15, dot(N, L));
    // Map physical roughness [0.05..0.95] to longitudinal exponent [220..10]
    float exponent = mix(220.0, 10.0, clamp(roughness * roughness, 0.0, 1.0));
    // Energy-conserving normalization factor
    float normFactor = (exponent + 2.0) / 8.0;
    return hemiVis * pow(sinTH, exponent) * normFactor * 0.095;
  }

  // Evaluate complete Physical Hair Shading (R + TRT + TT + Beer-Lambert Deep Shadow + Follicle AO)
  vec3 evaluatePhysicalHairShading(
    vec3 worldPos,
    vec3 surfNormal,
    vec3 hairTangent,
    float h,
    float strandSeed,
    float combMemory
  ) {
    vec3 N = normalize(surfNormal);
    vec3 T = normalize(hairTangent);
    vec3 V = normalize(cameraPosition - worldPos);
    vec3 L = normalize(uKeyLightDir);
    vec3 Lrim = normalize(uRimLightDir);

    // 1. Root-to-Tip Melanin / Pigment Gradient with per-strand micro-variation
    float rootTipMix = smoothstep(0.05, 0.92, pow(h, 0.82));
    vec3 strandTint = mix(vec3(0.96), vec3(1.04), fract(strandSeed * 13.37));
    vec3 albedo = mix(uBaseColor, uTipColor, rootTipMix) * strandTint;

    // 2. Follicle Ambient Occlusion (deep warm occlusion near skin roots)
    float follicleAO = mix(0.68, 1.0, pow(clamp(h, 0.0, 1.0), 0.72));

    // 3. Beer-Lambert Volumetric Hair Self-Shadowing (optical depth through coat)
    float NdotL = dot(N, L);
    float opticalDepth = (1.0 - h) * (0.45 + 0.55 * uFurDensity) / max(0.22, NdotL * 0.5 + 0.55);
    float deepShadow = exp(-opticalDepth * 0.65);
    float wrapDiffuse = clamp((NdotL + 0.45) / 1.45, 0.0, 1.0);

    // 4. Primary Specular Lobe (R): Cuticle surface reflection shifted toward root (-0.16 rad)
    float sheenBoost = 1.0 + combMemory * 0.35;
    vec3 tPrimary = shiftTangent(T, N, -0.16 + (strandSeed - 0.5) * 0.05);
    float specR = hairSpecularLobe(tPrimary, N, V, L, uRoughness) * uSpecular * sheenBoost;
    vec3 colorR = specR * uKeyLightColor * mix(vec3(1.0), albedo, 0.15);

    // 5. Secondary Specular Lobe (TRT): Internal reflection shifted toward tip (+0.24 rad), tinted by pigment
    vec3 tSecondary = shiftTangent(T, N, 0.24 + (strandSeed - 0.5) * 0.08);
    float glint = 0.75 + 0.5 * sin(strandSeed * 62.83);
    float specTRT = hairSpecularLobe(tSecondary, N, V, L, min(1.0, uRoughness * 1.35)) * uSpecular * 0.85 * glint;
    vec3 colorTRT = specTRT * mix(albedo, uTipColor, 0.65) * uKeyLightColor * 1.65;

    // 6. Forward Subsurface Scattering / Transmission Lobe (TT) from Key + Rim Backlights
    float forwardKey = pow(clamp(dot(V, -L + N * 0.35), 0.0, 1.0), 3.2);
    float forwardRim = pow(clamp(dot(V, -Lrim + N * 0.4), 0.0, 1.0), 2.4);
    float fresnelRim = pow(1.0 - max(0.0, dot(N, V)), 2.6);
    vec3 scatterTT = (
      forwardKey * uKeyLightColor * 0.38 +
      (forwardRim * 0.75 + fresnelRim * 0.65) * uRimLightColor * uRimIntensity
    ) * mix(uBaseColor, uTipColor, 0.75) * (0.35 + 0.65 * h);

    // 7. Soft Hemisphere Studio & 3D Environment Fill Lighting
    vec3 baseSkyColor = mix(uTipColor, vec3(0.88, 0.92, 1.0), 0.65);
    vec3 baseGroundColor = uBaseColor * 0.38;
    vec3 skyColor = mix(baseSkyColor, uEnvSkyColor, uEnvTintStrength);
    vec3 groundColor = mix(baseGroundColor, uEnvGroundColor, uEnvTintStrength);
    vec3 hemiFill = mix(groundColor, skyColor, N.y * 0.5 + 0.5) * uAmbientIntensity;

    // Combine all physical lobes while preserving intrinsic fur pigment hue in linear space
    vec3 balancedKeyTint = mix(vec3(1.0), uKeyLightColor, 0.58);
    vec3 directDiffuse = albedo * balancedKeyTint * uKeyLightIntensity * wrapDiffuse * deepShadow;
    vec3 directSpec = (colorR + colorTRT) * uKeyLightIntensity * deepShadow * (0.25 + 0.75 * h);
    vec3 ambientTerm = albedo * hemiFill * follicleAO;

    return directDiffuse + directSpec + scatterTT + ambientTerm;
  }
`;
