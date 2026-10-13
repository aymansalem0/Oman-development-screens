import type {NmcVesselProfile} from './nmc-vessel-catalog';
/**
 * POC-only manually curated offshore demo corridors. Coordinates are offshore
 * waypoints in the Arabian Gulf / Gulf of Oman, not live AIS or certified ENCs.
 * Markers and *interpolated segments* stay on these same polylines: no
 * arbitrary lat/lon random walk, no cross-land shortcut, no lateral jitter.
 * These corridors deliberately avoid port basins and coastal waypoints.
 */
export const AIRIA_OFFSHORE_CORRIDORS:Record<string,[number,number][]>={
 airiaGulfWestA:[[25.82,52.75],[25.86,53.05],[25.89,53.40],[25.91,53.77]],
 airiaGulfWestB:[[25.61,52.95],[25.65,53.25],[25.69,53.55],[25.73,53.89]],
 airiaGulfMidA:[[25.92,53.78],[25.93,54.03],[25.93,54.25],[25.93,54.47]],
 airiaGulfMidB:[[25.70,53.94],[25.74,54.18],[25.76,54.40],[25.77,54.61]],
 airiaGulfEast:[[25.89,54.30],[25.96,54.48],[26.03,54.66],[26.09,54.82]],
 airiaOmanA:[[25.20,57.02],[25.28,57.21],[25.34,57.43],[25.38,57.62]],
 airiaOmanB:[[25.08,57.10],[25.13,57.32],[25.19,57.54],[25.24,57.74]],
 airiaOmanC:[[25.44,57.08],[25.50,57.24],[25.55,57.44],[25.58,57.65]]
};
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
