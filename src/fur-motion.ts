import * as THREE from 'three';

/** A small damped spring driven by the actual body transform. Integrated once
 * per scene frame, never from a light-field camera or a separate render loop. */
export class FurMotion {
  readonly linear=new THREE.Vector3();
  readonly angular=new THREE.Vector3();
  readonly stretch=new THREE.Vector3();
  private linearSpringVelocity=new THREE.Vector3();
  private angularSpringVelocity=new THREE.Vector3();
  private stretchSpringVelocity=new THREE.Vector3();
  private position=new THREE.Vector3();
  private rotation=new THREE.Quaternion();
  private scale=new THREE.Vector3();
  private previousPosition=new THREE.Vector3();
  private previousRotation=new THREE.Quaternion();
  private previousScale=new THREE.Vector3();
  private previousVelocity=new THREE.Vector3();
  private velocity=new THREE.Vector3();
  private linearTarget=new THREE.Vector3();
  private angularTarget=new THREE.Vector3();
  private angularVelocity=new THREE.Vector3();
  private previousAngularVelocity=new THREE.Vector3();
  private stretchTarget=new THREE.Vector3();
  private inverseRotation=new THREE.Quaternion();
  private deltaRotation=new THREE.Quaternion();
  private time:number|undefined;

  update(seconds:number,matrix:THREE.Matrix4) {
    matrix.decompose(this.position,this.rotation,this.scale);
    const dt=this.time===undefined?0:seconds-this.time;
    if(this.time===undefined||dt<0||dt>.15) {
      this.linear.set(0,0,0);this.angular.set(0,0,0);this.stretch.set(0,0,0);
      this.linearSpringVelocity.set(0,0,0);this.angularSpringVelocity.set(0,0,0);this.stretchSpringVelocity.set(0,0,0);
      this.previousVelocity.set(0,0,0);
      this.previousAngularVelocity.set(0,0,0);
    } else if(dt>1e-5) {
      this.inverseRotation.copy(this.rotation).invert();
      this.velocity.subVectors(this.position,this.previousPosition).divideScalar(dt);
      this.linearTarget.subVectors(this.velocity,this.previousVelocity).multiplyScalar(-.035/dt).addScaledVector(this.velocity,-.12).applyQuaternion(this.inverseRotation).clampLength(0,.55);
      this.previousVelocity.copy(this.velocity);
      this.deltaRotation.copy(this.previousRotation).invert().multiply(this.rotation).normalize();
      if(this.deltaRotation.w<0) {
        this.deltaRotation.set(-this.deltaRotation.x,-this.deltaRotation.y,-this.deltaRotation.z,-this.deltaRotation.w);
      }
      const sinHalf=Math.hypot(this.deltaRotation.x,this.deltaRotation.y,this.deltaRotation.z);
      const angle=2*Math.atan2(sinHalf,this.deltaRotation.w);
      this.angularVelocity.set(this.deltaRotation.x,this.deltaRotation.y,this.deltaRotation.z).multiplyScalar(sinHalf>1e-8?angle/(dt*sinHalf):0);
      this.angularTarget.subVectors(this.angularVelocity,this.previousAngularVelocity).multiplyScalar(-.022/dt).addScaledVector(this.angularVelocity,-.38).clampLength(0,1.1);
      this.previousAngularVelocity.copy(this.angularVelocity);
      this.stretchTarget.subVectors(this.scale,this.previousScale).divide(this.scale).multiplyScalar(-.35/dt).clampScalar(-.3,.3);
      // Small substeps keep the softer spring stable at both 24 and 30 fps.
      const steps=Math.ceil(dt*120),step=dt/steps;
      for(let i=0;i<steps;i++) {
        this.spring(this.linear,this.linearSpringVelocity,this.linearTarget,step);
        this.spring(this.angular,this.angularSpringVelocity,this.angularTarget,step);
        this.spring(this.stretch,this.stretchSpringVelocity,this.stretchTarget,step);
      }
      this.linear.clampLength(0,.7);this.angular.clampLength(0,1.1);this.stretch.clampLength(0,.5);
    }
    this.previousPosition.copy(this.position);this.previousRotation.copy(this.rotation);this.previousScale.copy(this.scale);this.time=seconds;
  }
  private spring(value:THREE.Vector3,velocity:THREE.Vector3,target:THREE.Vector3,dt:number) {
    const stiffness=90,damping=12;
    velocity.x+=((target.x-value.x)*stiffness-velocity.x*damping)*dt;
    velocity.y+=((target.y-value.y)*stiffness-velocity.y*damping)*dt;
    velocity.z+=((target.z-value.z)*stiffness-velocity.z*damping)*dt;
    value.addScaledVector(velocity,dt);
  }
}
