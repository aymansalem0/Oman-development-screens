import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Read-only external PSC simulation, either matching local fixture snapshot or
 * actually fetched from the dedicated POC Google Sheet by the local Node proxy.
 * Neither data mode contains real/verified Riyadh MoU or port authority records.
 */
export interface NmcPscInspection {
  inspectionId: string;
  imo: string;
  vesselName: string;
  inspectionDate: string;
  port: string;
  country: string;
  result: string;
  deficiencyCount: number;
  openDeficiencies: number;
  detained: boolean;
  followUpRequired: boolean;
  reportPdfStatus: string;
}
export interface NmcPscDeficiency {
  deficiencyId: string;
  inspectionId: string;
  imo: string;
  category: string;
  description: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  status: 'OPEN' | 'CLOSED';
  closedDate: string;
  evidenceStatus: string;
}
export interface NmcPscDetention {
  detentionId: string;
  inspectionId: string;
  imo: string;
  detentionDate: string;
  releaseDate: string;
  port: string;
  country: string;
  reason: string;
  status: string;
}
export interface NmcExternalPscRecord {
  imo: string;
  vesselName: string;
  sourceSystem: string;
  datasetVersion: string;
  sourceMode: 'LOCAL_FIXTURE_SNAPSHOT' | 'GOOGLE_SHEETS_LIVE';
  dataNature: 'SYNTHETIC_NOT_RIYADH_MOU';
  authoritative: false;
  externalEvidenceVerified: false;
  pdfContentAvailable: false;
  coverage: 'SIMULATED_RECORDS' | 'NO_RECORD_IN_FIXTURE';
  retrievedAt: string;
  asOf: string;
  googleSheetsConnected: boolean;
  inspections: NmcPscInspection[];
  deficiencies: NmcPscDeficiency[];
  detentions: NmcPscDetention[];
  evidenceIds: string[];
  summary: { inspections: number; deficiencies: number; openDeficiencies: number; detentions: number };
  disclaimer: string;
}

@Injectable({providedIn:'root'})
export class NmcExternalPscService {
  constructor(private readonly http: HttpClient) {}
  getVessel(imo: string): Observable<NmcExternalPscRecord> {
    return this.http.get<NmcExternalPscRecord>(`/api/ai/psc/vessels/${encodeURIComponent(imo)}`);
  }
}
