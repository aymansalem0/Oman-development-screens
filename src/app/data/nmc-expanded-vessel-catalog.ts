import {
  NMC_VESSELS as BASE_NMC_VESSELS,
  NmcVesselProfile,
  SEA_ROUTES
} from './nmc-vessel-catalog';

const prefixes = [
  'Arabian','Gulf','Ocean','Emirates','Eastern','Northern','Coral','Sapphire','Pearl','Desert',
  'Marina','Falcon','Blue','Golden','Coastal','Horizon','Atlas','Crescent','Harbor','Seaway'
];
const suffixes = [
  'Horizon','Voyager','Meridian','Pioneer','Crest','Star','Bridge','Coast','Spirit','Wave',
  'Venture','Sentinel','Trader','Mariner','Breeze','Navigator','Prosperity','Aurora','Legacy','Endeavour'
];
const flags = ['UAE','Liberia','Panama','Marshall Is.','Singapore','Malta','Hong Kong','Bahamas'];
const types = ['Cargo','Tanker','Container','Bulk Carrier','Passenger','Offshore','Tug'];
const routeKeys = ['jebelAli','dubai','sharjah','khalifa','ruwais','das','fujairah'];

const routeMeta: Record<string, { destination: string; zone: string }> = {
  jebelAli:{destination:'Jebel Ali',zone:'UAE Approach'},
  dubai:{destination:'Dubai',zone:'Dubai Coastal'},
  sharjah:{destination:'Sharjah',zone:'Northern Emirates'},
  khalifa:{destination:'Khalifa Port',zone:'Abu Dhabi Approach'},
  ruwais:{destination:'Ruwais',zone:'Western Waters'},
  das:{destination:'Das Island',zone:'Offshore'},
  fujairah:{destination:'Fujairah',zone:'East Coast'}
};

const mmsiPrefixes: Record<string,string> = {
  UAE:'470',Liberia:'636',Panama:'352','Marshall Is.':'538',
  Singapore:'563',Malta:'256','Hong Kong':'477',Bahamas:'311'
};
const callPrefixes: Record<string,string> = {
  UAE:'A6',Liberia:'D5',Panama:'3E','Marshall Is.':'V7',
  Singapore:'9V',Malta:'9H','Hong Kong':'VR',Bahamas:'C6'
};
const classByFlag: Record<string,string> = {
  UAE:'Gulf Classification Society',
  Liberia:'Global Marine Classification',
  Panama:'International Register of Shipping',
  'Marshall Is.':'International Register of Shipping',
  Singapore:'Asia Marine Register',
  Malta:'European Marine Register',
  'Hong Kong':'Asia Marine Register',
  Bahamas:'International Register of Shipping'
};

function imo(sequence:number):string {
  const base=String(940000+sequence).slice(-6).padStart(6,'0');
  const w=[7,6,5,4,3,2];
  const check=base.split('').reduce((s,d,i)=>s+Number(d)*w[i],0)%10;
  return base+check;
}

function risk(id:number):number {
  const b=id%20;
  if(b===0) return 85+(Math.floor(id/20)%8);
  if(b===1||b===2) return 65+((id*7)%20);
  if(b===3||b===4) return 45+((id*5)%20);
  return 10+((id*11)%35);
}

function dimensions(type:string,id:number){
  const s=id%17;
  if(type==='Tanker') return {l:205+s*6,gt:42000+s*1800,dwt:76000+s*3100,sp:9.2+(id%30)/10};
  if(type==='Container') return {l:190+s*8,gt:48000+s*2300,dwt:56000+s*2600,sp:13.8+(id%35)/10};
  if(type==='Bulk Carrier') return {l:188+s*6,gt:36000+s*1700,dwt:64000+s*2800,sp:10.2+(id%25)/10};
  if(type==='Passenger') return {l:82+s*5,gt:7200+s*850,dwt:1800+s*190,sp:15.2+(id%45)/10};
  if(type==='Offshore') return {l:58+s*3,gt:2800+s*290,dwt:1500+s*140,sp:7.1+(id%25)/10};
  if(type==='Tug') return {l:29+s,gt:520+s*55,dwt:260+s*28,sp:5.4+(id%20)/10};
  return {l:125+s*5,gt:17000+s*1250,dwt:27000+s*1900,sp:10.4+(id%32)/10};
}

function bearing(lat1:number,lng1:number,lat2:number,lng2:number):number {
  const r=(d:number)=>d*Math.PI/180;
  const d=(v:number)=>v*180/Math.PI;
  const y=Math.sin(r(lng2-lng1))*Math.cos(r(lat2));
  const x=Math.cos(r(lat1))*Math.sin(r(lat2))-Math.sin(r(lat1))*Math.cos(r(lat2))*Math.cos(r(lng2-lng1));
  return Math.round((d(Math.atan2(y,x))+360)%360);
}

const seedNames=new Set(BASE_NMC_VESSELS.map(v=>v.name));

function makeVessel(id:number):NmcVesselProfile {
  const n=id-31;
  const prefix=prefixes[n%prefixes.length];
  const suffix=suffixes[Math.floor(n/prefixes.length)%suffixes.length];
  const candidate=prefix+' '+suffix;
  const name=seedNames.has(candidate)?candidate+' II':candidate;
  const flag=flags[id%flags.length];
  const type=types[(id*3)%types.length];
  const routeKey=routeKeys[(id*5)%routeKeys.length];
  const route=SEA_ROUTES[routeKey];
  const segmentIndex=(id*3)%(route.length-1);
  const start=route[segmentIndex];
  const end=route[segmentIndex+1];
  const t=.18+((id*7)%58)/100;
  const offset=((id%7)-3)*.0025;
  const lat=start[0]+(end[0]-start[0])*t+offset;
  const lng=start[1]+(end[1]-start[1])*t-offset;
  const dm=dimensions(type,id);
  const isUae=flag==='UAE';
  const etaH=(id*3)%24;
  const etaM=(id*7)%60;

  return {
    id,name,imo:imo(id),
    mmsi:mmsiPrefixes[flag]+String(100000+id*137).slice(-6),
    callSign:callPrefixes[flag]+id.toString(36).toUpperCase().padStart(4,'0').slice(-4),
    flag,type,lengthM:dm.l,built:1998+((id*7)%27),
    grossTonnage:Math.round(dm.gt).toLocaleString('en-US')+' GT',
    deadweight:Math.round(dm.dwt).toLocaleString('en-US')+' DWT',
    owner:isUae?prefix+' Maritime Services LLC':prefix+' '+suffix+' Shipping Ltd.',
    operator:isUae?prefix+' Maritime Services LLC':prefix+' Ship Management',
    classSociety:classByFlag[flag],
    speed:Number(dm.sp.toFixed(1)),
    course:bearing(lat,lng,end[0],end[1]),
    destination:routeMeta[routeKey].destination,
    eta:String(etaH).padStart(2,'0')+':'+String(etaM).padStart(2,'0'),
    navStatus:type==='Tug'?'Restricted manoeuvrability':'Under way using engine',
    lat:Number(lat.toFixed(5)),lng:Number(lng.toFixed(5)),
    risk:risk(id),zone:routeMeta[routeKey].zone,lastUpdate:2+(id%13),
    routeKey,segmentIndex,direction:1,
    dataConfidence:86+(id%14),riskConfidence:80+(id%17)
  };
}

const generated=Array.from({length:390},(_,i)=>makeVessel(i+31));

export const NMC_OPERATIONAL_VESSELS:NmcVesselProfile[]=[...BASE_NMC_VESSELS,...generated];

export function getOperationalVesselByImo(imoNumber:string):NmcVesselProfile|undefined {
  return NMC_OPERATIONAL_VESSELS.find(v=>v.imo===imoNumber);
}
