import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { SpecificationsModalComponent } from '../components/specifications-modal.component';
import { LanguageService } from '../services/language.service';

interface DetailRow {
  labelKey: string;
  value: string;
  translateValue?: boolean;
}

interface PartyInfoField {
  labelKey: string;
  valueEn: string;
  valueAr?: string;
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

  constructor(public lang: LanguageService) {}

  applicantData: PartyInfoField[] = [
    {
      labelKey: 'applicantName',
      valueEn: 'Al Murshid Navigation Services',
      valueAr: 'المرشد للخدمات الملاحية'
    },
    { labelKey: 'applicantId', valueEn: '12345678' },
    {
      labelKey: 'authorizedPersonName',
      valueEn: 'Mohammed Ahmed',
      valueAr: 'محمد أحمد'
    },
    { labelKey: 'authorizedPersonPhone', valueEn: '+968 99 000 000' },
    { labelKey: 'email', valueEn: 'applicant@example.om' }
  ];

  originalOwnerData: PartyInfoField[] = [
    {
      labelKey: 'originalOwnerName',
      valueEn: 'Marine Project Owner Company',
      valueAr: 'شركة مالك المشروع البحري'
    },
    {
      labelKey: 'authorizedPersonName',
      valueEn: 'Ahmed Al Balushi',
      valueAr: 'أحمد البلوشي'
    },
    { labelKey: 'authorizedPersonPhone', valueEn: '+968 99 111 111' },
    { labelKey: 'email', valueEn: 'owner@example.om' },
    { labelKey: 'faxNumber', valueEn: '+968 24 000 000' }
  ];

  rows: DetailRow[] = [
    { labelKey: 'aidType', value: 'BUOY', translateValue: true },
    { labelKey: 'navigationAidType', value: '--' },
    { labelKey: 'serialNumbers', value: '--' },
    { labelKey: 'structureType', value: '--' },
    { labelKey: 'lit', value: '--' },
    { labelKey: 'specificationPurpose', value: '--' },
    { labelKey: 'structureDetails', value: '--' },
    { labelKey: 'focalHeight', value: '--' },
    { labelKey: 'colourOfLight', value: '--' },
    { labelKey: 'colourOfStructure', value: '--' },
    { labelKey: 'signalCharacter', value: '--' },
    { labelKey: 'nominalRange', value: '--' },
    { labelKey: 'proposedNationalNumbers', value: '--' },
    { labelKey: 'topMark', value: '--' },
    { labelKey: 'visibleSector', value: '--' },
    { labelKey: 'proposedManufacturer', value: '--' },
    { labelKey: 'notes', value: '--' },
    { labelKey: 'technicalLocation', value: '--' },
    { labelKey: 'location', value: 'DUQM_PORT', translateValue: true },
    { labelKey: 'purpose', value: 'TEST', translateValue: true },
    { labelKey: 'installationCompany', value: 'AMENAS' }
  ];

  openSpecifications(): void {
    this.showSpecifications = true;
  }

  closeSpecifications(): void {
    this.showSpecifications = false;
  }

  displayValue(row: DetailRow): string {
    return row.translateValue ? this.lang.term(row.value) : row.value;
  }

  partyValue(field: PartyInfoField): string {
    return this.lang.isArabic && field.valueAr ? field.valueAr : field.valueEn;
  }

  onSpecificationsSaved(payload: any): void {
    this.savedPayload = payload;
    const specifications = payload?.specifications ?? [];
    const first = specifications[0];

    if (first) {
      this.patch('navigationAidType', first.navigationAidType || '--', true);
      this.patch('structureType', first.structureType || '--', true);
      this.patch('lit', first.lit ? 'YES' : 'NO', true);
      this.patch('specificationPurpose', first.specificationPurpose || '--', true);
      this.patch('structureDetails', first.structureDetails || '--');
      this.patch('focalHeight', first.focalHeight ? String(first.focalHeight) : '--');
      this.patch('colourOfLight', first.lightColour || '--', true);
      this.patch(
        'colourOfStructure',
        first.structureColour === 'OTHER'
          ? first.structureColourOther || 'OTHER'
          : first.structureColour || '--',
        first.structureColour !== 'OTHER'
      );
      this.patch('signalCharacter', first.signalCharacter || '--', true);
      this.patch('nominalRange', first.nominalRange ? first.nominalRange + ' NM' : '--');
      this.patch('proposedNationalNumbers', first.nationalNumbers || '--');
      this.patch('topMark', first.topMark || '--', true);
      this.patch(
        'visibleSector',
        first.visibleSector !== null && first.visibleSector !== '' ? first.visibleSector + '°' : '--'
      );
      this.patch('notes', first.notes || '--');
      this.patch('technicalLocation', first.technicalLocationDisplay || '--');
    }

    this.showSpecifications = false;
  }

  private patch(labelKey: string, value: string, translateValue = false): void {
    const row = this.rows.find(item => item.labelKey === labelKey);
    if (row) {
      row.value = value;
      row.translateValue = translateValue;
    }
  }
}
