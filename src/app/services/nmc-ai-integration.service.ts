import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type NmcAiriaAgent = 'a01' | 'a02' | 'a03' | 'a04';

/**
 * Angular talks ONLY to its same-origin Docker proxy.
 * AIRIA_MENA_KEY never reaches the browser.
 */
@Injectable({ providedIn: 'root' })
export class NmcAiIntegrationService {
  constructor(private readonly http: HttpClient) {}

  execute(agent: NmcAiriaAgent, payload: Record<string, unknown>): Observable<{ agent: NmcAiriaAgent; result: unknown }> {
    return this.http.post<{ agent: NmcAiriaAgent; result: unknown }>(
      `/api/ai/execute/${agent}`,
      { payload }
    );
  }
}
