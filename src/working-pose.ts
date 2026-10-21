// Adapted from alpha-bro-pets/src/pet/spec.ts: the six Working poses,
// their original 820 ms timing, and cyclic shape-preserving interpolation.
const durations = [120, 120, 120, 120, 120, 220];
export const workingDuration = durations.reduce((sum, ms) => sum + ms, 0);
export interface WorkingPose {
  sx:number; sy:number; tilt:number; faceX:number; faceY:number; eyeScale:number;
  leftX:number; leftY:number; rightX:number; rightY:number;
}
const poses:WorkingPose[] = durations.map((_, i) => {
  const phase = i / 6 * Math.PI * 2, sin = Math.sin(phase);
  return {
    sx:1 + sin*.03, sy:1 - sin*.03,
    tilt:[-.03,.03,-.02,.03,-.03,.02][i],
    faceX:sin*4, faceY:4 + Math.cos(phase*2)*3, eyeScale:i%3===1?.7:1,
    leftX:[-20,-12,-18,-8,-24,-16][i], leftY:[-9,-22,-9,-18,-9,-24][i],
    rightX:[14,20,8,16,22,12][i], rightY:[-24,-9,-18,-9,-26,-9][i],
  };
});
const keys = Object.keys(poses[0]) as (keyof WorkingPose)[];
function tangent(left:number, right:number, a:number, b:number) {
  if(left*right<=0) return 0;
  const w1=2*b+a, w2=b+2*a;
  return (w1+w2)/(w1/left+w2/right);
}
/** Mutates a caller-owned pose; no scene objects or geometry are created per frame. */
export function sampleWorkingPose(elapsedMs:number, target:WorkingPose):WorkingPose {
  let time=((elapsedMs%workingDuration)+workingDuration)%workingDuration, i=0;
  while(i<5 && time>=durations[i]) time-=durations[i++];
  const prev=(i+5)%6, next=(i+1)%6, after=(i+2)%6;
  const duration=durations[i], u=time/duration, u2=u*u, u3=u2*u;
  for(const key of keys) {
    const from=poses[i][key], to=poses[next][key], slope=(to-from)/duration;
    const start=tangent((from-poses[prev][key])/durations[prev],slope,durations[prev],duration);
    const end=tangent(slope,(poses[after][key]-to)/durations[next],duration,durations[next]);
    target[key]=(2*u3-3*u2+1)*from+(u3-2*u2+u)*duration*start+(-2*u3+3*u2)*to+(u3-u2)*duration*end;
  }
  return target;
}
export function createWorkingPose():WorkingPose { return {...poses[0]}; }
