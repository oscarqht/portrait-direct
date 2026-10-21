import * as THREE from 'three';

/** Opaque scene backdrop: it participates in each camera's transmission capture.
 * A derivative-filtered gray line grid stays crisp without external textures. */
export function createGlassGrid() {
  const material=new THREE.ShaderMaterial({
    uniforms:{paper:{value:new THREE.Color('#fafafa')},ink:{value:new THREE.Color('#b8bbc1')}},
    vertexShader:'varying vec2 gridPosition;void main(){gridPosition=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`
      uniform vec3 paper,ink;
      varying vec2 gridPosition;
      void main(){
        vec2 p=gridPosition/.28;
        vec2 distanceToLine=abs(fract(p-.5)-.5)/max(fwidth(p),vec2(.0001));
        float line=1.-smoothstep(.45,1.25,min(distanceToLine.x,distanceToLine.y));
        gl_FragColor=vec4(mix(paper,ink,line),1.);
        #include <colorspace_fragment>
      }`,
    toneMapped:false,
  });
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(20,20),material);
  mesh.name='glass-gray-grid';mesh.position.z=-1.1;return mesh;
}
