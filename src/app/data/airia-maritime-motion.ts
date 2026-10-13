import type {NmcVesselProfile} from './nmc-vessel-catalog';
/**
 * POC-only manually curated offshore demo corridors. Coordinates are offshore
 * waypoints in the Arabian Gulf / Gulf of Oman, not live AIS or certified ENCs.
 * Markers and *interpolated segments* stay on these same polylines: no
 * arbitrary lat/lon random walk, no cross-land shortcut, no lateral jitter.
 * These corridors deliberately avoid port basins and coastal waypoints.
 */
import seaRoutes from './airia-offshore-corridors.json';
export const AIRIA_OFFSHORE_CORRIDORS=seaRoutes as unknown as Record<string,[number,number][]>;
export const AIRIA_ROUTE_KEYS=Object.keys(AIRIA_OFFSHORE_CORRIDORS);
export const AIRIA_MOTION_DISCLAIMER='Illustrative vessel tracks constrained to preselected offshore waypoints, NOT verified AIS or navigational routing.';

type MotionVessel=Pick<NmcVesselProfile,'id'|'speed'|'routeKey'|'routeProgress'|'lat'|'lng'|'segmentIndex'|'direction'|'course'>;
function bearing(a:[number,number],b:[number,number]):number{
 const rad=(n:number)=>n*Math.PI/180;
 const d=(n:number)=>n*180/Math.PI;
 const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0]));
 const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-
   Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));
 return (d(Math.atan2(y,x))+360)%360;
}
export function offshorePoint(routeKey:string,phase:number):{
 lat:number;lng:number;segmentIndex:number;direction:1|-1;course:number
}{
 const route=AIRIA_OFFSHORE_CORRIDORS[routeKey];
 if(!route||route.length<2||!Number.isFinite(phase))throw new Error('SEA_CORRIDOR_INVALID');
 const progress=((phase%2)+2)%2;
 const forward=progress<=1;
 const linear=(forward?progress:2-progress)*(route.length-1);
 const index=Math.min(route.length-2,Math.floor(linear));
 const frac=linear-index;
 const a=route[index],b=route[index+1];
 const direction=forward?1:-1;
 return {
  lat:a[0]+(b[0]-a[0])*frac,lng:a[1]+(b[1]-a[1])*frac,
  segmentIndex:forward?index:Math.min(route.length-1,index+1),
  direction,
  course:forward?bearing(a,b):bearing(b,a)
 };
}
export function initialOffshoreVessel(v:NmcVesselProfile,position:number):NmcVesselProfile{
 const routeKey=AIRIA_ROUTE_KEYS[position%AIRIA_ROUTE_KEYS.length];
 const progress=((position*0.137+0.19)%1.92)+0.04;
 return {...v,routeKey,routeProgress:progress,
  ...offshorePoint(routeKey,progress)};
}
export function advanceOffshoreVessel(v:NmcVesselProfile,seconds=2.5):NmcVesselProfile{
 if(!AIRIA_OFFSHORE_CORRIDORS[v.routeKey])throw new Error('VESSEL_NOT_ON_OFFSHORE_ROUTE');
 // Approximate movement 2.5-second tick, deliberately slowed for POC map.
 // All movement remains an interpolation of the defined offshore segments.
 const phase=((v.routeProgress??0)+(Math.max(0,v.speed)*seconds/150000))%2;
 return {...v,routeProgress:phase,...offshorePoint(v.routeKey,phase)};
}
