import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient,withInterceptors } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import {moeiSessionInterceptor} from './app/services/moei-session.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations(),
    provideHttpClient(withInterceptors([moeiSessionInterceptor])),
    provideRouter(routes, withHashLocation())
  ]
}).catch(err => console.error(err));
