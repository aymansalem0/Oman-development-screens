import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { SpecificationsModalComponent } from '../components/specifications-modal.component';

interface DetailRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-approval-detail',
  standalone: true,
  imports: [CommonModule, SpecificationsModalComponent],
  templateUrl: './approval-detail.component.html'
})
export class ApprovalDetailComponent {
  showSpecifications = false;
  savedPayload: unknown = null;

  rows: DetailRow[] = [
    { label: 'Aid Type', value: 'Buoy' },
    { label: 'Navigation Aid Type', value: '--' },
    { label: 'Serial Numbers', value: '--' },
    { label: 'Structure Type', value: '--' },
    { label: 'Lit', value: '--' },
    { label: 'Specification Purpose', value: '--' },
    { label: 'Structure Details', value: '--' },
    { label: 'Focal Height', value: '--' },
    { label: 'Colour of Light', value: '--' },
    { label: 'Colour of Structure', value: '--' },
    { label: 'Signal Character', value: '--' },
    { label: 'Nominal Range', value: '--' },
    { label: 'Proposed National Numbers', value: '--' },
    { label: 'Top Mark', value: '--' },
    { label: 'Visible Sector', value: '--' },
    { label: 'Proposed Manufacturer', value: '--' },
    { label: 'Notes', value: '--' },
    { label: 'Technical Location', value: '--' },
    { label: 'Location', value: 'ميناء الدقم' },
    { label: 'Purpose', value: 'اختبار' },
    { label: 'Installation Responsible Company', value: 'Aminas' }
  ];

  openSpecifications(): void {
    this.showSpecifications = true;
  }

  closeSpecifications(): void {
    this.showSpecifications = false;
  }

  onSpecificationsSaved(payload: any): void {
    this.savedPayload = payload;
    const specifications = payload?.specifications ?? [];
    const first = specifications[0];

    if (first) {
      this.patch('Navigation Aid Type', first.navigationAidType || '--');
      this.patch('Structure Type', first.structureType || '--');
      this.patch('Lit', first.lit ? 'Yes' : 'No');
      this.patch('Specification Purpose', first.specificationPurpose || '--');
      this.patch('Structure Details', first.structureDetails || '--');
      this.patch('Focal Height', first.focalHeight ? String(first.focalHeight) : '--');
      this.patch('Colour of Light', first.lightColour || '--');
      this.patch(
        'Colour of Structure',
        first.structureColour === 'Other'
          ? first.structureColourOther || 'Other'
          : first.structureColour || '--'
      );
      this.patch('Signal Character', first.signalCharacter || '--');
      this.patch('Nominal Range', first.nominalRange ? first.nominalRange + ' NM' : '--');
      this.patch('Proposed National Numbers', first.nationalNumbers || '--');
      this.patch('Top Mark', first.topMark || '--');
      this.patch('Visible Sector', first.visibleSector !== null && first.visibleSector !== '' ? first.visibleSector + '°' : '--');
      this.patch('Notes', first.notes || '--');
      this.patch('Technical Location', first.technicalLocationDisplay || '--');
    }

    this.showSpecifications = false;
  }

  private patch(label: string, value: string): void {
    const row = this.rows.find(item => item.label === label);
    if (row) {
      row.value = value;
    }
  }
}
