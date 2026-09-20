import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import {
  ReactiveFormsModule,
  UntypedFormArray,
  UntypedFormBuilder,
  UntypedFormGroup,
  Validators
} from '@angular/forms';
import { LanguageService } from '../services/language.service';

interface DdlOption {
  code: string;
}

interface ManufacturerOption {
  key: string;
  code: string;
  icon: string;
}

@Component({
  selector: 'app-specifications-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './specifications-modal.component.html'
})
export class SpecificationsModalComponent {
  expandedSpecification = 0;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<any>();

  readonly maxFileSize = 5 * 1024 * 1024;
  readonly allowedExtensions = ['jpg', 'jpeg', 'png', 'pdf'];

  readonly navigationAidTypes: DdlOption[] = [
    { code: 'PORT_HAND_LATERAL' },
    { code: 'STARBOARD_HAND_LATERAL' },
    { code: 'PREFERRED_CHANNEL_PORT' },
    { code: 'PREFERRED_CHANNEL_STARBOARD' },
    { code: 'NORTH_CARDINAL' },
    { code: 'EAST_CARDINAL' },
    { code: 'SOUTH_CARDINAL' },
    { code: 'WEST_CARDINAL' },
    { code: 'ISOLATED_DANGER' },
    { code: 'SAFE_WATER' },
    { code: 'SPECIAL_MARK' },
    { code: 'EWMB' },
    { code: 'LIGHTHOUSE' },
    { code: 'SECTOR_LIGHT' },
    { code: 'LEADING_LINE' }
  ];

  readonly lightColours: DdlOption[] = [
    { code: 'WHITE' },
    { code: 'RED' },
    { code: 'GREEN' },
    { code: 'YELLOW' },
    { code: 'BLUE' }
  ];

  readonly structureColours: DdlOption[] = [
    { code: 'WHITE' },
    { code: 'BLACK' },
    { code: 'RED' },
    { code: 'GREEN' },
    { code: 'YELLOW' },
    { code: 'BLUE' },
    { code: 'ORANGE' },
    { code: 'OTHER' }
  ];

  readonly signalCharacters: DdlOption[] = [
    { code: 'FIXED_LIGHT' },
    { code: 'OCCULTING' },
    { code: 'GROUP_OCCULTING' },
    { code: 'ISOPHASE' },
    { code: 'FLASHING' },
    { code: 'LONG_FLASHING' },
    { code: 'GROUP_FLASHING' },
    { code: 'COMPOSITE_GROUP_FLASHING' },
    { code: 'QUICK' },
    { code: 'GROUP_QUICK' },
    { code: 'INTERRUPTED_QUICK' },
    { code: 'VERY_QUICK' },
    { code: 'GROUP_VERY_QUICK' },
    { code: 'INTERRUPTED_VERY_QUICK' },
    { code: 'ULTRA_QUICK' },
    { code: 'INTERRUPTED_ULTRA_QUICK' },
    { code: 'MORSE' },
    { code: 'ALTERNATING' }
  ];

  readonly topMarks: DdlOption[] = [
    { code: 'TOP_NONE' },
    { code: 'CONE_UP' },
    { code: 'CONE_DOWN' },
    { code: 'TWO_CONES_UP' },
    { code: 'TWO_CONES_DOWN' },
    { code: 'TWO_CONES_BASE_TO_BASE' },
    { code: 'TWO_CONES_POINT_TO_POINT' },
    { code: 'CYLINDER_CAN' },
    { code: 'SPHERE' },
    { code: 'TWO_SPHERES' },
    { code: 'X_SHAPE' },
    { code: 'EW_CROSS' }
  ];

  readonly structureTypes: DdlOption[] = [
    { code: 'FIXED' },
    { code: 'FLOATING' }
  ];

  readonly purposes: DdlOption[] = [
    { code: 'NEW_INSTALLATION' },
    { code: 'REPLACEMENT' },
    { code: 'RELOCATION' },
    { code: 'MODIFICATION_UPGRADE' },
    { code: 'TEMPORARY_INSTALLATION' },
    { code: 'PERMANENT_INSTALLATION' },
    { code: 'TRIAL_TESTING' }
  ];

  readonly manufacturers: ManufacturerOption[] = [
    { key: 'concrete', code: 'CONCRETE_STRUCTURE', icon: '▦' },
    { key: 'chains', code: 'MOORING_CHAINS', icon: '⌘' },
    { key: 'buoys', code: 'MARINE_BUOY', icon: '♟' },
    { key: 'columns', code: 'STEEL_COLUMN', icon: '♜' },
    { key: 'light', code: 'NAVIGATION_LIGHT', icon: '☀' }
  ];

  form: UntypedFormGroup;

  constructor(
    private fb: UntypedFormBuilder,
    public lang: LanguageService
  ) {
    this.form = this.fb.group({
      specifications: this.fb.array([
        this.createSpecification(),
        this.createSpecification()
      ])
    });
  }

  get specifications(): UntypedFormArray {
    return this.form.get('specifications') as UntypedFormArray;
  }

  specification(index: number): UntypedFormGroup {
    return this.specifications.at(index) as UntypedFormGroup;
  }

  manufacturerGroup(specIndex: number, key: string): UntypedFormGroup {
    return this.specification(specIndex).get(this.manufacturerControlName(key)) as UntypedFormGroup;
  }

  onStructureColourChange(index: number): void {
    const group = this.specification(index);
    if (group.get('structureColour')?.value !== 'OTHER') {
      group.get('structureColourOther')?.setValue('');
    }
  }

  onFileSelected(event: Event, specIndex: number, manufacturerKey: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

    if (!this.allowedExtensions.includes(extension)) {
      window.alert(this.lang.t('unsupportedFile'));
      input.value = '';
      return;
    }

    if (file.size > this.maxFileSize) {
      window.alert(this.lang.t('maxFileSize'));
      input.value = '';
      return;
    }

    this.manufacturerGroup(specIndex, manufacturerKey).patchValue({
      file,
      fileName: file.name
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const firstInvalid = document.querySelector('.spec-modal .ng-invalid');
      firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const raw = this.form.getRawValue();
    const payload = {
      specifications: raw.specifications.map((item: any, index: number) => ({
        specificationNo: index + 1,
        ...item,
        nominalRangeDisplay: item.nominalRange ? item.nominalRange + ' NM' : null,
        visibleSectorDisplay:
          item.visibleSector !== null && item.visibleSector !== ''
            ? item.visibleSector + '°'
            : null,
        technicalLocationDisplay:
          item.location.latDeg + '°' +
          item.location.latMin + '′ ' +
          item.location.latDir + ', ' +
          item.location.lonDeg + '°' +
          item.location.lonMin + '′ ' +
          item.location.lonDir
      }))
    };

    this.saved.emit(payload);
  }

  close(): void {
    this.closed.emit();
  }

  toggleSpecification(index: number): void {
    this.expandedSpecification = this.expandedSpecification === index ? -1 : index;
  }

  isExpanded(index: number): boolean {
    return this.expandedSpecification === index;
  }

  trackByIndex(index: number): number {
    return index;
  }

  private createSpecification(): UntypedFormGroup {
    return this.fb.group({
      navigationAidType: ['', Validators.required],
      structureType: ['', Validators.required],
      lit: [null, Validators.required],
      specificationPurpose: ['', Validators.required],
      structureDetails: [''],
      focalHeight: [''],
      lightColour: ['', Validators.required],
      structureColour: ['', Validators.required],
      structureColourOther: [''],
      signalCharacter: ['', Validators.required],
      nominalRange: ['', [Validators.required, Validators.min(0)]],
      nationalNumbers: ['', Validators.required],
      topMark: [''],
      visibleSector: ['', [Validators.min(0), Validators.max(360)]],
      notes: [''],
      location: this.fb.group({
        latDeg: ['', [Validators.required, Validators.min(0), Validators.max(90)]],
        latMin: ['', [Validators.required, Validators.min(0), Validators.max(59.999)]],
        latDir: ['N', Validators.required],
        lonDeg: ['', [Validators.required, Validators.min(0), Validators.max(180)]],
        lonMin: ['', [Validators.required, Validators.min(0), Validators.max(59.999)]],
        lonDir: ['E', Validators.required]
      }),
      manufacturerConcrete: this.createManufacturer(),
      manufacturerChains: this.createManufacturer(),
      manufacturerBuoys: this.createManufacturer(),
      manufacturerColumns: this.createManufacturer(),
      manufacturerLight: this.createManufacturer()
    });
  }

  private createManufacturer(): UntypedFormGroup {
    return this.fb.group({
      companyName: [''],
      file: [null],
      fileName: ['']
    });
  }

  private manufacturerControlName(key: string): string {
    const names: Record<string, string> = {
      concrete: 'manufacturerConcrete',
      chains: 'manufacturerChains',
      buoys: 'manufacturerBuoys',
      columns: 'manufacturerColumns',
      light: 'manufacturerLight'
    };

    return names[key];
  }
}
