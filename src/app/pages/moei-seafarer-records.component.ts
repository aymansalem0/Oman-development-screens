import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcPlatformHeaderComponent} from '../components/nmc-platform-chrome.component';
import {LanguageService} from '../services/language.service';
import {
 SeafarerWorkspaceService,SdbDashboard,SdbProfile,SdbCertificate
} from '../services/seafarer-workspace.service';

/**
 * Registered SDB-holder 360° demonstration. Identity, SID and issued status
 * are read from the actor-scoped SDB sandbox API. Sea-service legs below are
 * expressly synthetic POC records; do not represent verified national data.
 */
interface SeaLeg {
 id:string;profileId:string;vessel:string;imo:string;vesselType:string;
 flag:string;grossTonnage:number;deadweight:number;mainEngine:string;
 enginePowerKw:number;engineCount:number;rank:string;department:string;
 company:string;signOn:string;signOff:string;sourceReference:string;
 evidenceState:'POC_UNVERIFIED';
}
interface GroupTotal{label:string;days:number;voyages:number;ships:number;}
const DEMO_LEGS:SeaLeg[]=[
 {id:'SEA-101',profileId:'SF-003',vessel:'Gulf Voyager',imo:'9328471',
  vesselType:'Container Ship',flag:'UAE',grossTonnage:42000,deadweight:51000,
  mainEngine:'2-stroke marine diesel',enginePowerKw:24400,engineCount:1,
  rank:'Third Officer',department:'Deck',company:'National Sea Transport',
  signOn:'2023-03-10',signOff:'2023-10-01',sourceReference:'POC-SEA-003-A',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-102',profileId:'SF-003',vessel:'Arabian Horizon',imo:'9400497',
  vesselType:'Bulk Carrier',flag:'UAE',grossTonnage:32000,deadweight:58000,
  mainEngine:'Low-speed diesel',enginePowerKw:9800,engineCount:1,
  rank:'Second Officer',department:'Deck',company:'National Sea Transport',
  signOn:'2024-02-15',signOff:'2024-09-02',sourceReference:'POC-SEA-003-B',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-103',profileId:'SF-003',vessel:'Harbour Pioneer',imo:'9400894',
  vesselType:'Tanker',flag:'UAE',grossTonnage:29000,deadweight:48500,
  mainEngine:'Medium-speed diesel',enginePowerKw:11400,engineCount:1,
  rank:'Second Officer',department:'Deck',company:'National Sea Transport',
  signOn:'2025-01-05',signOff:'2025-08-12',sourceReference:'POC-SEA-003-C',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-201',profileId:'SF-004',vessel:'Harbour Star',imo:'9400643',
  vesselType:'Ro-Ro Vessel',flag:'UAE',grossTonnage:22000,deadweight:10000,
  mainEngine:'Dual-fuel medium-speed',enginePowerKw:16500,engineCount:2,
  rank:'Third Officer',department:'Deck',company:'Harbour Marine LLC',
  signOn:'2023-06-17',signOff:'2023-12-09',sourceReference:'POC-SEA-004-A',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-202',profileId:'SF-004',vessel:'Harbour Star',imo:'9400643',
  vesselType:'Ro-Ro Vessel',flag:'UAE',grossTonnage:22000,deadweight:10000,
  mainEngine:'Dual-fuel medium-speed',enginePowerKw:16500,engineCount:2,
  rank:'Second Officer',department:'Deck',company:'Harbour Marine LLC',
  signOn:'2024-05-06',signOff:'2024-12-18',sourceReference:'POC-SEA-004-B',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-301',profileId:'SF-005',vessel:'Pearl Horizon',imo:'9400894',
  vesselType:'Tanker',flag:'UAE',grossTonnage:36000,deadweight:62000,
  mainEngine:'2-stroke marine diesel',enginePowerKw:12700,engineCount:1,
  rank:'Engine Cadet',department:'Engine',company:'National Sea Transport',
  signOn:'2023-07-01',signOff:'2023-12-12',sourceReference:'POC-SEA-005-A',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-302',profileId:'SF-005',vessel:'Pearl Horizon',imo:'9400894',
  vesselType:'Tanker',flag:'UAE',grossTonnage:36000,deadweight:62000,
  mainEngine:'2-stroke marine diesel',enginePowerKw:12700,engineCount:1,
  rank:'Fourth Engineer',department:'Engine',company:'National Sea Transport',
  signOn:'2024-04-10',signOff:'2024-10-28',sourceReference:'POC-SEA-005-B',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-401',profileId:'SF-006',vessel:'Emirates Voyager II',imo:'9400540',
  vesselType:'Container Ship',flag:'UAE',grossTonnage:51000,deadweight:63000,
  mainEngine:'Slow-speed diesel',enginePowerKw:28700,engineCount:1,
  rank:'Able Seafarer Deck',department:'Deck',company:'National Sea Transport',
  signOn:'2024-01-10',signOff:'2024-07-20',sourceReference:'POC-SEA-006-A',evidenceState:'POC_UNVERIFIED'},
 {id:'SEA-501',profileId:'SF-007',vessel:'Arabian Coastal',imo:'9400497',
  vesselType:'General Cargo',flag:'UAE',grossTonnage:7800,deadweight:10800,
  mainEngine:'Medium-speed diesel',enginePowerKw:3900,engineCount:1,
  rank:'Watchkeeping Officer',department:'Deck',company:'National Sea Transport',
  signOn:'2024-05-12',signOff:'2025-02-17',sourceReference:'POC-SEA-007-A',evidenceState:'POC_UNVERIFIED'}
];
@Component({
 selector:'app-moei-seafarer-records',standalone:true,
 imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent,NmcPlatformHeaderComponent],
 templateUrl:'./moei-seafarer-records.component.html',
 styleUrl:'./moei-seafarer-records.component.css'
})
export class MoeiSeafarerRecordsComponent implements OnInit{
 data:SdbDashboard|null=null;
 selectedId='';query='';typeFilter='ALL';
 loading=true;error='';
 view:'OVERVIEW'|'SEA_SERVICE'|'QUALIFICATIONS'='OVERVIEW';
 constructor(private api:SeafarerWorkspaceService,public lang:LanguageService){}
 ngOnInit():void{this.refresh();}
 t(en:string,ar:string):string{return this.lang.pick(en,ar);}
 refresh():void{
  this.loading=true;
  this.api.dashboard().subscribe({
   next:d=>{this.data=d;this.loading=false;this.error='';
    if(!this.holders.some(p=>p.id===this.selectedId))
     this.selectedId=this.holders[0]?.id||'';
   },
   error:e=>{this.loading=false;
    this.error=(e as {error?:{error?:string}})?.error?.error||'SDB_RECORDS_UNAVAILABLE';}
  });
 }
 get holders():SdbProfile[]{
  return (this.data?.profiles||[]).filter(p=>!!p.existingSdb);
 }
 get selected():SdbProfile|null{
  return this.holders.find(p=>p.id===this.selectedId)||null;
 }
 get filtered():SdbProfile[]{
  const q=this.query.trim().toLowerCase();
  return this.holders.filter(p=>
   (!q||[p.name,p.id,p.existingSdb?.sid||'',p.rank].some(x=>
     x.toLowerCase().includes(q)))&&
   (this.typeFilter==='ALL'||this.legsFor(p.id).some(l=>l.vesselType===this.typeFilter))
  );
 }
 get types():string[]{return [...new Set(DEMO_LEGS.map(l=>l.vesselType))].sort();}
 legsFor(id:string):SeaLeg[]{return DEMO_LEGS.filter(l=>l.profileId===id);}
 get legs():SeaLeg[]{return this.legsFor(this.selectedId);}
 days(leg:SeaLeg):number{
  const from=Date.parse(leg.signOn+'T00:00:00Z'),
   to=Date.parse(leg.signOff+'T00:00:00Z');
  return Number.isFinite(from)&&Number.isFinite(to)&&to>=from?
    Math.floor((to-from)/86400000)+1:0;
 }
 get totalDays():number{return this.legs.reduce((n,v)=>n+this.days(v),0);}
 get distinctShips():number{return new Set(this.legs.map(l=>l.imo)).size;}
 get totalVoyages():number{return this.legs.length;}
 get allDemoDays():number{
  return this.holders.reduce((n,p)=>n+this.legsFor(p.id).reduce((x,l)=>x+this.days(l),0),0);
 }
 get roles():string[]{return [...new Set(this.legs.map(l=>l.rank))];}
 get aggregatesByRank():GroupTotal[]{
  const groups=new Map<string,SeaLeg[]>();
  for(const leg of this.legs)groups.set(leg.rank,[...(groups.get(leg.rank)||[]),leg]);
  return [...groups].map(([label,rows])=>({
   label,days:rows.reduce((n,r)=>n+this.days(r),0),
   voyages:rows.length,ships:new Set(rows.map(r=>r.imo)).size
  })).sort((a,b)=>b.days-a.days);
 }
 get aggregatesByType():GroupTotal[]{
  const groups=new Map<string,SeaLeg[]>();
  for(const leg of this.legs)
   groups.set(leg.vesselType,[...(groups.get(leg.vesselType)||[]),leg]);
  return [...groups].map(([label,rows])=>({
   label,days:rows.reduce((n,r)=>n+this.days(r),0),
   voyages:rows.length,ships:new Set(rows.map(r=>r.imo)).size
  })).sort((a,b)=>b.days-a.days);
 }
 get qualifications():SdbCertificate[]{
  const p=this.selected;if(!p)return [];
  const cert=[...p.certificates];
  if(p.coc)cert.push({id:p.id+'-COC',type:'CoC',
   title:'Certificate of Competency',status:p.coc.status,
   issueDate:'',expiryDate:p.coc.expiryDate,reference:p.coc.reference});
  if(p.endorsement)cert.push({id:p.id+'-ENDORSEMENT',type:'Endorsement',
   title:'Foreign certificate endorsement',status:p.endorsement.status,
   issueDate:'',expiryDate:p.endorsement.expiryDate,reference:p.endorsement.reference});
  return cert;
 }
 isCertificateCurrent(c:SdbCertificate):boolean{
  return c.status==='VALID'&&c.expiryDate>=new Date().toISOString().slice(0,10);
 }
 formatDays(days:number):string{
  const years=Math.floor(days/365),months=Math.floor((days%365)/30);
  return this.t(
   (years?years+'y ':'')+(months?months+'m ':'')+days+'d total',
   'إجمالي '+days+' يوم ('+years+' سنة و'+months+' شهر تقريبًا)'
  );
 }
 select(p:SdbProfile):void{this.selectedId=p.id;this.view='OVERVIEW';}
}
