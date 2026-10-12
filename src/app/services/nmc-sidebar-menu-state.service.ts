import {Injectable} from '@angular/core';

export type MainMaritimeGroup='nmc'|'smart'|'settings';
export type SettingsMaritimeGroup='nmc'|'inspection';
export type MaritimeDashboardGroup='nmc'|'smart'|'settings';

/**
 * UI-only accordion state for the shared maritime sidebar.
 *
 * All submenus start CLOSED after a full browser load, including on bookmarked
 * deep links. Only the group explicitly clicked by the user expands.
 * The singleton survives Angular Router page component recreation so opening
 * a child screen does not collapse the menu immediately.
 *
 * No localStorage/sessionStorage, API requests, user permissions or records.
 */
@Injectable({providedIn:'root'})
export class NmcSidebarMenuStateService{
  main:MainMaritimeGroup|null=null;
  settings:SettingsMaritimeGroup|null=null;
  dashboard:MaritimeDashboardGroup|null=null;

  toggleMain(group:MainMaritimeGroup):void{
    if(this.main===group){
      this.main=null;
      this.settings=null;
      this.dashboard=null;
      return;
    }
    this.main=group;
    this.settings=null;
    this.dashboard=null;
  }

  toggleSettings(group:SettingsMaritimeGroup):void{
    if(this.main!=='settings')return;
    if(this.settings===group){
      this.settings=null;
      this.dashboard=null;
      return;
    }
    this.settings=group;
    this.dashboard=null;
  }

  toggleDashboard(group:MaritimeDashboardGroup):void{
    if(this.main!==group)return;
    if(group==='settings'&&this.settings!=='nmc')return;
    this.dashboard=this.dashboard===group?null:group;
  }
}
