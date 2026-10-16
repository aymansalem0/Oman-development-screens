import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { map } from "rxjs";
import { MoeiAuthService } from "./moei-auth.service";
/** A fixed allowlist is shared with the OAuth server; no arbitrary return URLs. */
export const seafarerRouteGuard: CanActivateFn = (_route, state) => {
  const auth = inject(MoeiAuthService),
    router = inject(Router);
  const allowed = [
    "/moei/seafarers/services",
    "/moei/seafarers/company",
    "/moei/seafarers/readiness",
    "/moei/seafarers/notifications",
    "/moei/seafarers/fulfilment",
  ];
  const returnTo = allowed.includes(state.url)
    ? state.url
    : "/moei/seafarers/services";
  return auth
    .check()
    .pipe(
      map((ok) =>
        ok
          ? true
          : router.createUrlTree(["/moei/login"], {
              queryParams: { returnTo },
            }),
      ),
    );
};
