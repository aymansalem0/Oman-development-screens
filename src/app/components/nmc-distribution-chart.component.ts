import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import {
  DashboardMetric, NmcChartPalette, NmcChartType
} from '../services/nmc-dashboard-store.service';

export interface NmcChartDatum {
  name: string;
  count: number;
  percent: number;
}
interface ChartSlice extends NmcChartDatum {
  color:string;
  share:number;
  path:string;
}
interface ChartPoint {x:number;y:number;name:string;count:number;color:string;}

/**
 * Pure SVG/CSS renderer for NMC categorical distributions. Chart styles
 * present the same filtered vessel counts, NOT a historical time series.
 * No third-party chart library, external CDN or additional data request.
 */
@Component({
  selector:'app-nmc-distribution-chart',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./nmc-distribution-chart.component.html',
  styleUrl:'./nmc-distribution-chart.component.css'
})
export class NmcDistributionChartComponent {
  @Input() rows: NmcChartDatum[]=[];
  @Input() metric: DashboardMetric='byRisk';
  @Input() chartType: NmcChartType='horizontalBar';
  @Input() palette: NmcChartPalette='maritime';
  @Input() isArabic=false;

  private readonly colors:Record<NmcChartPalette,string[]>={
    maritime:['#087f8c','#14b8a6','#3169a8','#8b5cf6','#e2a23a','#ec7284','#64748b','#0e7490'],
    vibrant:['#6366f1','#ef476f','#06d6a0','#ffb703','#118ab2','#f97316','#a855f7','#34d399'],
    ocean:['#0369a1','#0891b2','#0d9488','#38bdf8','#2563eb','#7c3aed','#22c55e','#60a5fa'],
    sunset:['#c2410c','#ea580c','#f59e0b','#e879f9','#db2777','#9333ea','#e11d48','#f97316']
  };
  private readonly riskColors:Record<string,string>={
    Normal:'#16a34a',
    Watch:'#eab308',
    High:'#f97316',
    Critical:'#dc2626',
    Pending:'#94a3b8'
  };
  get hasData():boolean{return this.rows.some(r=>r.count>0);}
  get total():number{return this.rows.reduce((sum,r)=>sum+r.count,0);}
  get maximum():number{return Math.max(1,...this.rows.map(r=>r.count));}
  get variant():NmcChartType{
    return ['horizontalBar','column','pie','donut','line','area'].includes(this.chartType)
      ?this.chartType:'horizontalBar';
  }
  get pieStyle():boolean{return this.variant==='pie'||this.variant==='donut';}
  get lineStyle():boolean{return this.variant==='line'||this.variant==='area';}

  color(name:string,index:number):string{
    if(this.metric==='byRisk')return this.riskColors[name]||'#64748b';
    const theme=this.colors[this.palette]||this.colors.maritime;
    return theme[index % theme.length];
  }
  height(count:number):number {
    return Math.round(Math.max(0,count/this.maximum)*100);
  }
  short(name:string):string {
    return name.length>13?name.slice(0,12)+'…':name;
  }
  percentage(count:number):string{
    return this.total>0?(count/this.total*100).toFixed(1)+'%':'0%';
  }
  get colorRows():Array<NmcChartDatum & {color:string}>{
    return this.rows.map((r,i)=>({...r,color:this.color(r.name,i)}));
  }

  get slices():ChartSlice[]{
    const total=this.total;
    if(total<=0)return [];
    let angle=-Math.PI/2;
    return this.colorRows.filter(r=>r.count>0).map(r=>{
      const span=r.count/total*2*Math.PI;
      const path=this.sector(angle,angle+span,this.variant==='donut'?52:0);
      angle+=span;
      return {...r,path,share:r.count/total};
    });
  }

  private sector(start:number,end:number,inner:number):string{
    const cx=125,cy=125,r=94;
    const xy=(radius:number,angle:number):string=>
      (cx+radius*Math.cos(angle)).toFixed(3)+' '+(cy+radius*Math.sin(angle)).toFixed(3);
    if(end-start>=2*Math.PI-1e-8){
      const outer=`M ${xy(r,start)} A ${r} ${r} 0 1 1 ${xy(r,start+Math.PI)} A ${r} ${r} 0 1 1 ${xy(r,start)}`;
      if(!inner)return outer+' Z';
      return `${outer} L ${xy(inner,start)} A ${inner} ${inner} 0 1 0 ${xy(inner,start+Math.PI)} A ${inner} ${inner} 0 1 0 ${xy(inner,start)} Z`;
    }
    const large=end-start>Math.PI?1:0;
    const outer=`M ${inner?xy(inner,start):cx+' '+cy} L ${xy(r,start)} A ${r} ${r} 0 ${large} 1 ${xy(r,end)}`;
    return inner?
      `${outer} L ${xy(inner,end)} A ${inner} ${inner} 0 ${large} 0 ${xy(inner,start)} Z`:
      outer+' Z';
  }

  get points():ChartPoint[]{
    const rows=this.colorRows;
    const step=rows.length>1?440/(rows.length-1):0;
    return rows.map((r,index)=>({
      x:48+index*step,
      y:205-r.count/this.maximum*161,
      name:r.name,count:r.count,color:r.color
    }));
  }
  get linePath():string{
    return this.points.map((p,i)=>(i?'L ':'M ')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
  }
  get areaPath():string{
    const points=this.points;
    return points.length
      ? `M ${points[0].x} 205 ${this.linePath.replace(/^M /,'L ')} L ${points[points.length-1].x} 205 Z`
      : '';
  }
  get mainColor():string{
    return this.metric==='byRisk'?'#087f8c':this.colorRows[0]?.color||'#087f8c';
  }
  get grid():Array<{y:number;label:string}>{
    return [0,.25,.5,.75,1].map(r=>({
      y:205-161*r,
      label:String(Math.round(this.maximum*r))
    }));
  }
}
