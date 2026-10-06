import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

type RiskLevel = 'Critical' | 'High' | 'Watch' | 'Normal';

interface Vessel {
  id: number;
  name: string;
  imo: string;
  mmsi: string;
  flag: string;
  type: string;
  speed: number;
  course: number;
  destination: string;
  eta: string;
  x: number;
  y: number;
  risk: number;
  zone: string;
  lastUpdate: number;
}

interface MaritimeEvent {
  time: string;
  vessel: string;
  title: string;
  detail: string;
  severity: 'critical' | 'high' | 'info';
}

@Component({
  selector: 'app-nmc-command-center',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './nmc-command-center.component.html',
  styleUrl: './nmc-command-center.component.css'
})
export class NmcCommandCenterComponent implements OnInit, OnDestroy {
  searchTerm = '';
  riskFilter = 'All';
  typeFilter = 'All';
  feedLive = true;
  scenarioActive = true;
  selectedVessel?: Vessel;
  now = new Date();
  private timer?: ReturnType<typeof setInterval>;

  vessels: Vessel[] = [
    { id: 1, name: 'MV Gulf Horizon', imo: '9328471', mmsi: '636019872', flag: 'Liberia', type: 'Cargo', speed: 3.1, course: 287, destination: 'Jebel Ali', eta: '03:30', x: 43, y: 45, risk: 87, zone: 'UAE Approach', lastUpdate: 4 },
    { id: 2, name: 'Ocean Star', imo: '9781207', mmsi: '352001947', flag: 'Panama', type: 'Tanker', speed: 10.2, course: 214, destination: 'Fujairah', eta: '05:10', x: 72, y: 48, risk: 74, zone: 'East Coast', lastUpdate: 7 },
    { id: 3, name: 'Sea Pearl', imo: '9904410', mmsi: '470012281', flag: 'UAE', type: 'Passenger', speed: 17.6, course: 305, destination: 'Dubai', eta: '01:45', x: 53, y: 30, risk: 28, zone: 'UAE Waters', lastUpdate: 5 },
    { id: 4, name: 'Blue Falcon', imo: '9612456', mmsi: '538008731', flag: 'Marshall Is.', type: 'Container', speed: 15.4, course: 296, destination: 'Khalifa Port', eta: '04:20', x: 30, y: 54, risk: 61, zone: 'Abu Dhabi Approach', lastUpdate: 11 },
    { id: 5, name: 'Al Dana', imo: '9853312', mmsi: '470045821', flag: 'UAE', type: 'Offshore', speed: 8.4, course: 110, destination: 'Das Island', eta: '06:40', x: 22, y: 35, risk: 18, zone: 'Offshore', lastUpdate: 8 },
    { id: 6, name: 'Eastern Crown', imo: '9758418', mmsi: '563091200', flag: 'Singapore', type: 'Bulk Carrier', speed: 12.1, course: 276, destination: 'Jebel Ali', eta: '07:15', x: 61, y: 39, risk: 49, zone: 'UAE Approach', lastUpdate: 6 },
    { id: 7, name: 'Desert Wave', imo: '9441251', mmsi: '470031118', flag: 'UAE', type: 'Tug', speed: 6.2, course: 19, destination: 'Port Rashid', eta: '02:05', x: 48, y: 24, risk: 12, zone: 'Dubai Coastal', lastUpdate: 3 },
    { id: 8, name: 'Northern Light', imo: '9711240', mmsi: '256883000', flag: 'Malta', type: 'Container', speed: 14.7, course: 302, destination: 'Jebel Ali', eta: '05:55', x: 57, y: 56, risk: 66, zone: 'UAE Approach', lastUpdate: 9 },
    { id: 9, name: 'Arabian Swift', imo: '9885016', mmsi: '470055120', flag: 'UAE', type: 'Cargo', speed: 11.8, course: 89, destination: 'Sharjah', eta: '04:05', x: 64, y: 25, risk: 34, zone: 'Northern Emirates', lastUpdate: 12 },
    { id: 10, name: 'Golden Reef', imo: '9520447', mmsi: '538009112', flag: 'Marshall Is.', type: 'Tanker', speed: 9.6, course: 266, destination: 'Ruwais', eta: '08:30', x: 16, y: 60, risk: 53, zone: 'Western Waters', lastUpdate: 6 },
    { id: 11, name: 'Coral Bridge', imo: '9693412', mmsi: '354221000', flag: 'Panama', type: 'Cargo', speed: 13.3, course: 310, destination: 'Khalifa Port', eta: '06:10', x: 35, y: 43, risk: 24, zone: 'Abu Dhabi Approach', lastUpdate: 10 },
    { id: 12, name: 'Falcon Spirit', imo: '9830097', mmsi: '470066911', flag: 'UAE', type: 'Passenger', speed: 18.9, course: 61, destination: 'Dubai', eta: '01:35', x: 50, y: 18, risk: 21, zone: 'Dubai Coastal', lastUpdate: 4 }
  ];

  events: MaritimeEvent[] = [
    { time: '22:42:18', vessel: 'MV Gulf Horizon', title: 'Risk escalated to CRITICAL', detail: 'Movement anomaly correlated with unresolved inspection deficiency and certificate condition.', severity: 'critical' },
    { time: '22:41:56', vessel: 'MV Gulf Horizon', title: 'Certificate data conflict', detail: 'MOEI record: Conditionally Valid · External source: Valid.', severity: 'high' },
    { time: '22:41:31', vessel: 'MV Gulf Horizon', title: 'Abnormal speed reduction', detail: 'Speed reduced from 13.4 kn to 3.1 kn inside UAE Approach monitoring zone.', severity: 'high' },
    { time: '22:40:14', vessel: 'Ocean Star', title: 'Enhanced monitoring started', detail: 'Risk threshold exceeded due to historical inspection indicators.', severity: 'info' },
    { time: '22:38:09', vessel: 'Northern Light', title: 'Route deviation detected', detail: 'Observed route differs from declared destination corridor.', severity: 'info' }
  ];

  ngOnInit(): void {
    this.addBackgroundVessels();
    this.selectedVessel = this.vessels[0];
    this.timer = setInterval(() => {
      this.now = new Date();
      if (this.feedLive) {
        this.moveVessels();
      }
    }, 2000);
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private addBackgroundVessels(): void {
    const flags = ['Bahamas', 'Hong Kong', 'UAE', 'Panama', 'Liberia', 'Singapore'];
    const types = ['Cargo', 'Tanker', 'Container', 'Bulk Carrier', 'Offshore'];
    const destinations = ['Jebel Ali', 'Fujairah', 'Khalifa Port', 'Sharjah', 'Ruwais'];
    const zones = ['UAE Approach', 'UAE Waters', 'East Coast', 'Western Waters'];

    for (let i = 13; i <= 30; i++) {
      const risk = (i * 17) % 58;
      this.vessels.push({
        id: i,
        name: `Vessel ${String(i).padStart(2, '0')}`,
        imo: String(9100000 + i * 1137),
        mmsi: String(470000000 + i * 1793),
        flag: flags[i % flags.length],
        type: types[i % types.length],
        speed: 7 + ((i * 13) % 110) / 10,
        course: (i * 31) % 360,
        destination: destinations[i % destinations.length],
        eta: `${String((i + 1) % 24).padStart(2, '0')}:${i % 2 ? '15' : '45'}`,
        x: 12 + ((i * 19) % 73),
        y: 15 + ((i * 23) % 65),
        risk,
        zone: zones[i % zones.length],
        lastUpdate: 2 + (i % 12)
      });
    }
  }

  private moveVessels(): void {
    this.vessels = this.vessels.map((v, index) => {
      const dx = ((index % 3) - 1) * 0.12;
      const dy = (((index + 1) % 3) - 1) * 0.08;
      return {
        ...v,
        x: Math.max(6, Math.min(92, v.x + dx)),
        y: Math.max(8, Math.min(88, v.y + dy)),
        lastUpdate: Math.max(1, (v.lastUpdate + 2) % 14)
      };
    });

    if (this.selectedVessel) {
      this.selectedVessel = this.vessels.find(v => v.id === this.selectedVessel?.id);
    }
  }

  get filteredVessels(): Vessel[] {
    const q = this.searchTerm.trim().toLowerCase();
    return this.vessels.filter(v => {
      const matchesSearch = !q || [v.name, v.imo, v.destination, v.flag].some(value => value.toLowerCase().includes(q));
      const matchesRisk = this.riskFilter === 'All' || this.riskLevel(v.risk) === this.riskFilter;
      const matchesType = this.typeFilter === 'All' || v.type === this.typeFilter;
      return matchesSearch && matchesRisk && matchesType;
    });
  }

  get attentionVessels(): Vessel[] {
    return [...this.vessels].filter(v => v.risk >= 45).sort((a, b) => b.risk - a.risk).slice(0, 6);
  }

  get vesselTypes(): string[] {
    return ['All', ...Array.from(new Set(this.vessels.map(v => v.type))).sort()];
  }

  get monitoredCount(): number {
    return this.vessels.length;
  }

  get attentionCount(): number {
    return this.vessels.filter(v => v.risk >= 45).length;
  }

  get highRiskCount(): number {
    return this.vessels.filter(v => v.risk >= 65).length;
  }

  get criticalCount(): number {
    return this.vessels.filter(v => v.risk >= 85).length;
  }

  riskLevel(score: number): RiskLevel {
    if (score >= 85) return 'Critical';
    if (score >= 65) return 'High';
    if (score >= 45) return 'Watch';
    return 'Normal';
  }

  riskClass(score: number): string {
    return this.riskLevel(score).toLowerCase();
  }

  selectVessel(vessel: Vessel): void {
    this.selectedVessel = vessel;
  }

  toggleFeed(): void {
    this.feedLive = !this.feedLive;
  }

  replayScenario(): void {
    const vessel = this.vessels.find(v => v.id === 1);
    if (!vessel) return;

    vessel.risk = 87;
    vessel.speed = 3.1;
    this.selectedVessel = vessel;
    this.scenarioActive = true;

    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const replayEvent: MaritimeEvent = {
      time,
      vessel: vessel.name,
      title: 'POC scenario replayed',
      detail: 'Movement anomaly + open deficiency + certificate conflict correlated into a critical maritime event.',
      severity: 'critical'
    };

    this.events = [replayEvent, ...this.events].slice(0, 8);
  }
}
