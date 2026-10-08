import { Injectable } from '@angular/core';
import { NmcVesselProfile, SEA_ROUTES } from '../data/nmc-vessel-catalog';
import { NmcRiskEngineService } from './nmc-risk-engine.service';

/** All records below are deterministic, fictional POC fixtures (not registry/AIS feeds). */
export interface NmcPocCertificate {
  id: string;
  type: string;
  number: string;
  issuer: string;
  issued: string;
  expiry: string;
  status: 'Valid' | 'Conditional' | 'Expiring';
  source: string;
  condition?: string;
  conflict?: boolean;
}
export interface NmcPocInspection {
  id: string;
  date: string;
  port: string;
  type: string;
  result: 'Passed' | 'Deficiencies Found' | 'Follow-up Required';
  inspector: string;
  source: string;
  openDeficiencies: number;
}
export interface NmcPocDeficiency {
  id: string;
  category: string;
  description: string;
  severity: 'Critical' | 'Major' | 'Minor';
  status: 'Open' | 'Closed';
  raised: string;
  due: string;
  evidence: string;
  riskImpact: number;
}
export interface NmcPocEvidence {
  id: string;
  type: 'VESSEL' | 'AIS' | 'ROUTE' | 'INSPECTION' | 'DEFICIENCY' | 'CERTIFICATE' | 'CLASS' | 'DATA_QUALITY' | 'HISTORY';
  source: string;
  status: 'SYNTHETIC_RECORD' | 'SYNTHETIC_SCENARIO' | 'REFERENCED_ONLY';
  record: Record<string, unknown>;
}
export interface NmcVesselEvidenceBundle {
  bundleRef: string;
  vessel: NmcVesselProfile;
  evidence: NmcPocEvidence[];
  evidenceIds: string[];
  inlineContext: Record<string, unknown>;
  certificates: NmcPocCertificate[];
  inspections: NmcPocInspection[];
  deficiencies: NmcPocDeficiency[];
}

/**
 * Shared POC evidence source for Vessel 360 and the Airia request adapter.
 *
 * This does NOT read Google Drive or live authoritative systems. It intentionally
 * exposes the synthetic records that Vessel 360 already displays, so agents
 * can reason about actual request content rather than arbitrary evidence IDs.
 */
@Injectable({ providedIn: 'root' })
export class NmcVesselEvidenceService {
  constructor(private readonly riskEngine: NmcRiskEngineService) {}

  create(vessel: NmcVesselProfile): NmcVesselEvidenceBundle {
    const baseRisk = this.riskEngine.evaluate(vessel).baseScore;
    const hasOpenDeficiency = baseRisk >= 45;
    const hasCertificateConflict = baseRisk >= 80;
    const isUae = vessel.flag === 'UAE';
    const authority = this.flagAuthority(vessel.flag);
    const ins = `INS-2026-${String(1300 + vessel.id).padStart(5, '0')}`;
    const riskContribution = this.riskEngine.evaluate(vessel).factors
      .find(factor => factor.key === 'inspection')?.contribution || 0;

    // Exact same four sample certificate rows as Vessel 360.
    const certificates: NmcPocCertificate[] = [
      {
        id: `CERT-SC-${vessel.imo}`,
        type: 'Cargo Ship Safety Construction Certificate',
        number: `CSC-${vessel.imo}-2026`,
        issuer: isUae ? 'MOEI Maritime Affairs' : authority,
        issued: '12 Feb 2026',
        expiry: vessel.risk >= 55 ? '19 Dec 2026' : '11 Feb 2031',
        status: hasCertificateConflict ? 'Conditional' : vessel.risk >= 55 ? 'Expiring' : 'Valid',
        source: isUae ? 'MOEI Certificate Registry' : 'Verified Flag / RO Certificate Record',
        ...(hasCertificateConflict
          ? { condition: 'Subject to verification of an outstanding safety condition before unrestricted operation.',
              conflict: true }
          : {})
      },
      {
        id: `CERT-SR-${vessel.imo}`, type: 'Ship Safety Radio Certificate',
        number: `CSR-${vessel.imo}-2025`,
        issuer: isUae ? 'MOEI Recognized Organization' : vessel.classSociety,
        issued: '18 Nov 2025', expiry: '17 Nov 2027', status: 'Valid',
        source: isUae ? 'MOEI Certificate Registry' : 'Recognized Organization Record'
      },
      {
        id: `CERT-SE-${vessel.imo}`, type: 'Ship Safety Equipment Certificate',
        number: `CSE-${vessel.imo}-2025`,
        issuer: isUae ? 'MOEI Recognized Organization' : vessel.classSociety,
        issued: '02 Sep 2025', expiry: vessel.risk >= 65 ? '01 Dec 2026' : '01 Sep 2028',
        status: vessel.risk >= 65 ? 'Expiring' : 'Valid',
        source: isUae ? 'MOEI Certificate Registry' : 'Recognized Organization Record'
      },
      {
        id: `CERT-ISSC-${vessel.imo}`, type: 'International Ship Security Certificate',
        number: `ISSC-${vessel.imo}-2024`, issuer: authority,
        issued: '04 Apr 2024', expiry: '03 Apr 2029', status: 'Valid',
        source: isUae ? 'MOEI / Flag-State Record' : 'External Flag Record'
      }
    ];

    // These inspections and deficiency IDs are the ones actually displayed by Vessel 360.
    const inspections: NmcPocInspection[] = [
      {
        id: ins, date: '19 Aug 2026', port: vessel.destination,
        type: 'Port State / Safety Inspection',
        result: vessel.risk >= 65 ? 'Follow-up Required'
          : vessel.risk >= 45 ? 'Deficiencies Found' : 'Passed',
        inspector: 'MOEI Smart Inspection', source: 'Smart Inspection',
        openDeficiencies: hasOpenDeficiency ? 1 : 0
      },
      {
        id: `INS-2026-${String(400 + vessel.id).padStart(5, '0')}`,
        date: '13 Mar 2026', port: vessel.zone,
        type: 'Safety Compliance Inspection',
        result: vessel.risk >= 50 ? 'Deficiencies Found' : 'Passed',
        inspector: 'MOEI Smart Inspection', source: 'Smart Inspection', openDeficiencies: 0
      },
      {
        id: `INS-2025-${String(2900 + vessel.id).padStart(5, '0')}`,
        date: '22 Nov 2025', port: 'UAE',
        type: 'Routine Inspection', result: 'Passed',
        inspector: 'MOEI Smart Inspection', source: 'Smart Inspection', openDeficiencies: 0
      }
    ];

    const deficiencies: NmcPocDeficiency[] = [];
    if (hasOpenDeficiency) {
      const critical = vessel.risk >= 80;
      deficiencies.push({
        id: `DEF-2026-${400 + vessel.id}`,
        category: critical ? 'Fire Safety' : 'Safety Equipment',
        description: critical
          ? 'Fixed fire detection and alarm system failed functional verification during the latest inspection.'
          : 'Safety equipment finding remains open pending corrective-action evidence.',
        severity: critical ? 'Critical' : 'Major',
        status: 'Open', raised: '19 Aug 2026', due: '02 Sep 2026',
        evidence: `Inspection report ${ins} · supporting evidence attached`,
        riskImpact: riskContribution
      });
    }
    deficiencies.push({
      id: `DEF-2026-${100 + vessel.id}`, category: 'Life Saving Appliances',
      description: 'Historical inspection finding closed after corrective evidence was accepted.',
      severity: 'Minor', status: 'Closed', raised: '13 Mar 2026', due: '20 Mar 2026',
      evidence: 'Closure evidence accepted', riskImpact: 0
    });

    const route = SEA_ROUTES[vessel.routeKey] || SEA_ROUTES['jebelAli'];
    const expectedRoute = route.map(([lat, lng]) => ({ lat, lng }));
    const observedTrack = route.map(([lat, lng], index) => {
      const anomalyIndex = Math.min(2, route.length - 2);
      return {
        lat: lat + (vessel.risk >= 65 && index === anomalyIndex ? 0.025 : 0),
        lng: lng + (vessel.risk >= 65 && index === anomalyIndex ? -0.025 : 0)
      };
    });
    const routeId = `ROUTE-${vessel.imo}`;
    const aisId = `AIS-${vessel.mmsi}`;
    const historyId = `HIST-${vessel.imo}`;
    const dataQualityId = `DQC-${vessel.imo}`;
    const classId = `CLASS-${vessel.imo}`;
    const openDeficiency = deficiencies.filter(item => item.status === 'Open');

    const evidence: NmcPocEvidence[] = [
      {
        id: `VES-${vessel.imo}`, type: 'VESSEL', source: 'NMC synthetic vessel catalog',
        status: 'SYNTHETIC_RECORD',
        record: { imo: vessel.imo, name: vessel.name, flag: vessel.flag, owner: vessel.owner,
          operator: vessel.operator, classSociety: vessel.classSociety, built: vessel.built }
      },
      {
        id: aisId, type: 'AIS', source: 'Simulated AIS current position',
        status: 'SYNTHETIC_RECORD',
        record: { mmsi: vessel.mmsi, speed: vessel.speed, course: vessel.course,
          position: { lat: vessel.lat, lng: vessel.lng }, destination: vessel.destination,
          eta: vessel.eta, navStatus: vessel.navStatus, lastUpdateMinutes: vessel.lastUpdate }
      },
      {
        id: routeId, type: 'ROUTE', source: 'Vessel 360 synthetic map track',
        status: 'SYNTHETIC_SCENARIO',
        record: { routeKey: vessel.routeKey, expectedRoute, observedTrack,
          disclaimer: 'Synthetic route and observed-track geometry, not independent live AIS measurements.' }
      },
      ...inspections.map(row => ({
        id: row.id, type: 'INSPECTION' as const, source: 'Vessel 360 inspection fixture',
        status: 'SYNTHETIC_RECORD' as const, record: { ...row }
      })),
      ...deficiencies.map(row => ({
        id: row.id, type: 'DEFICIENCY' as const, source: 'Vessel 360 deficiency fixture',
        status: 'SYNTHETIC_RECORD' as const, record: { ...row }
      })),
      ...certificates.map(row => ({
        id: row.id, type: 'CERTIFICATE' as const, source: 'Vessel 360 certificate fixture',
        status: 'SYNTHETIC_RECORD' as const, record: { ...row }
      })),
      {
        id: classId, type: 'CLASS', source: 'Synthetic class-status comparison',
        status: 'SYNTHETIC_SCENARIO',
        record: { classSociety: vessel.classSociety,
          flagAuthority: authority, certificateStatusConflict: hasCertificateConflict,
          status: hasCertificateConflict ? 'REQUIRES_VERIFICATION' : 'NO_CONFLICT_IN_FIXTURE',
          notice: 'Fictional comparison; external authority has not been contacted.' }
      },
      {
        id: dataQualityId, type: 'DATA_QUALITY', source: 'NMC scenario correlation',
        status: 'SYNTHETIC_SCENARIO',
        record: { dataConfidence: vessel.dataConfidence / 100,
          certificateSourceConflict: hasCertificateConflict,
          externalAuthorityVerified: false, simulatedFeedOnly: true }
      },
      {
        id: historyId, type: 'HISTORY', source: 'Vessel 360 inspection history fixture',
        status: 'SYNTHETIC_SCENARIO',
        record: { inspectionIds: inspections.map(row => row.id),
          openDeficiencyIds: openDeficiency.map(row => row.id),
          closedDeficiencyIds: deficiencies.filter(row => row.status === 'Closed').map(row => row.id),
          currentOperator: vessel.operator,
          priorOperatorHistory: 'NOT_AVAILABLE',
          detentionHistory: 'NOT_AVAILABLE',
          notice: 'Historical claims limited to the three supplied synthetic inspections.' }
      }
    ];

    const inlineContext: Record<string, unknown> = {
      vessel: { imo: vessel.imo, name: vessel.name, mmsi: vessel.mmsi, callSign: vessel.callSign,
        flag: vessel.flag, vesselType: vessel.type, lengthM: vessel.lengthM, built: vessel.built,
        grossTonnage: vessel.grossTonnage, deadweight: vessel.deadweight,
        owner: vessel.owner, operator: vessel.operator, classSociety: vessel.classSociety },
      registration: { flag: vessel.flag, isUaeFlag: isUae, flagStateAuthority: authority,
        moeiRole: isUae ? 'UAE Flag State' : 'UAE Port/Coastal-State oversight only',
        status: 'SYNTHETIC_POC_UNVERIFIED' },
      tracking: { mmsi: vessel.mmsi, speed: vessel.speed, course: vessel.course,
        latitude: vessel.lat, longitude: vessel.lng, destination: vessel.destination,
        eta: vessel.eta, navStatus: vessel.navStatus, zone: vessel.zone,
        routeKey: vessel.routeKey, lastUpdateMinutes: vessel.lastUpdate },
      routeExpectation: { evidenceId: routeId, expectedRoute, observedTrack,
        routeGeometryType: 'SYNTHETIC_DEMO', liveHistoricalTrackAvailable: false },
      certificates, inspections, deficiencies,
      history: { evidenceId: historyId, inspections,
        openDeficiencyCount: openDeficiency.length, closedDeficiencyCount: deficiencies.length - openDeficiency.length,
        vesselOperator: vessel.operator, priorOperatorHistoryAvailable: false,
        detentionHistoryAvailable: false },
      dataQuality: { evidenceId: dataQualityId, overallConfidence: vessel.dataConfidence / 100,
        riskConfidence: vessel.riskConfidence / 100, sourceConflict: hasCertificateConflict,
        externalSystemsConnected: false },
      documentManifest: { source: 'GOOGLE_DRIVE_NOT_CONNECTED', records: [],
        contentAvailable: false, note: 'Document PDFs not loaded or validated by this inline-only POC adapter.' },
      evidence,
      provenance: { environment: 'SYNTHETIC_POC',
        source: 'Vessel 360 deterministic fixture / NMC_OPERATIONAL_VESSELS',
        evidenceIds: evidence.map(row => row.id),
        notice: 'These are complete structured SAMPLE facts shown by Vessel 360. They are not official AIS, port-state records, certificates, verified operator history or actual PDFs. Use them for POC scenario analysis only. Never claim official evidence has been authenticated.' }
    };
    return { bundleRef: `VBL-${vessel.imo}`, vessel, certificates, inspections,
      deficiencies, evidence, evidenceIds: evidence.map(row => row.id), inlineContext };
  }

  private flagAuthority(flag: string): string {
    const authorities: Record<string, string> = {
      UAE: 'MOEI Vessel Registry',
      Liberia: 'Liberia Maritime Authority',
      Panama: 'Panama Maritime Authority',
      'Marshall Is.': 'Marshall Islands Maritime Administrator',
      Singapore: 'Maritime and Port Authority of Singapore',
      Malta: 'Malta Ship Registry',
      'Hong Kong': 'Hong Kong Shipping Registry',
      Bahamas: 'Bahamas Maritime Authority'
    };
    return authorities[flag] || `${flag} Flag Administration`;
  }
}
