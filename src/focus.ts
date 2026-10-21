import * as THREE from 'three';

export type FocusPoint = [number, number, number];
export const focusDepthLimit = 2;
export const cameraDistance = (zoom:number) => 10 / zoom;
export function focalDistance(zoom:number, depth:number) {
  return Math.max(.2, cameraDistance(zoom) - depth);
}
/** Parallel camera axes; shift only the frustum to put depth at zero disparity. */
export function setViewCamera(camera:THREE.PerspectiveCamera, distance:number, offset:number, aspect:number, focusDistance:number) {
  camera.position.set(offset,0,distance);
  const near=camera.near, halfY=near*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const midpoint=-near*offset/focusDistance;
  camera.projectionMatrix.makePerspective(midpoint-halfY*aspect,midpoint+halfY*aspect,halfY,-halfY,near,camera.far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld(true);
}
export function worldFocus(content:THREE.Object3D, point:FocusPoint) {
  return content.localToWorld(new THREE.Vector3(...point));
}
