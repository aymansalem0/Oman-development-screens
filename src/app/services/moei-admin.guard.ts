import {CanActivateFn,Router} from '@angular/router';
import {inject} from '@angular/core';
import {map} from 'rxjs';
import {MoeiAuthService} from './moei-auth.service';

export const moeiAdminGuard:CanActivateFn=()=>{
  const auth=inject(MoeiAuthService),router=inject(Router);
  return auth.check().pipe(map(ok=>ok?true:router.createUrlTree(['/moei/login'])));
};
