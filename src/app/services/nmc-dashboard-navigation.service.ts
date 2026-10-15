import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  NmcDashboardWorkspaceService, PublishedDashboardMenuItem
} from './nmc-dashboard-workspace.service';

@Injectable({providedIn:'root'})
export class NmcDashboardNavigationService {
  private readonly subject=new BehaviorSubject<PublishedDashboardMenuItem[]>([]);
  readonly published$=this.subject.asObservable();

  constructor(private readonly workspace:NmcDashboardWorkspaceService){}

  /** Refresh sidebar links from the centrally published dashboard registry. */
  refresh():void{
    this.workspace.publishedMenu().subscribe({
      next:response=>{
        this.subject.next((response.dashboards||[])
          .filter(d=>!!d.id&&!!d.title&&
            ['NMC_CENTER','SMART_INSPECTION','SETTINGS'].includes(d.menuPlacement))
          .sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id)));
      },
      error:()=>{
        // Do not synthesize published links while the central store is offline.
        // Existing loaded links can still attempt the read-only viewer route.
      }
    });
  }
}
