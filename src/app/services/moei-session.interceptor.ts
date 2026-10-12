import {HttpInterceptorFn,HttpErrorResponse} from '@angular/common/http';
import {inject} from '@angular/core';
import {Router} from '@angular/router';
import {catchError,throwError} from 'rxjs';

/** Cookie session is sent by browser, never exposed to JavaScript. */
export const moeiSessionInterceptor:HttpInterceptorFn=(req,next)=>{
  if(!req.url.startsWith('/api/'))return next(req);
  const authRoute=req.url.startsWith('/api/moei/auth/');
  const mutate=!['GET','HEAD','OPTIONS'].includes(req.method);
  const request=mutate?req.clone({setHeaders:{'X-MOEI-CSRF':'1'}}):req;
  const router=inject(Router);
  return next(request).pipe(catchError((err:unknown)=>{
    if(err instanceof HttpErrorResponse&&err.status===401&&!authRoute){
      void router.navigate(['/moei/login']);
    }
    return throwError(()=>err);
  }));
};
