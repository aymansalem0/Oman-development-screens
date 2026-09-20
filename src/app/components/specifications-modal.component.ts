import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import {
  ReactiveFormsModule,
  UntypedFormArray,
  UntypedFormBuilder,
  UntypedFormGroup,
  Validators
} from '@angular/forms';

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

  // IALA R1001 / R0110 / R0201 aligned controlled lists.
  // Oman operates within IALA Maritime Buoyage Region A.
  readonly navigationAidTypes = [
    'Port-hand Lateral Mark',
    'Starboard-hand Lateral Mark',
    'Preferred Channel - Port Hand',
    'Preferred Channel - Starboard Hand',
    'North Cardinal Mark',
    'East Cardinal Mark',
    'South Cardinal Mark',
    'West Cardinal Mark',
    'Isolated Danger Mark',
    'Safe Water Mark',
    'Special Mark',
    'Emergency Wreck Marking Buoy (EWMB)',
    'Lighthouse',
    'Sector Light',
    'Leading Line / Range Mark'
  ];

  readonly lightColours = [
    'White',
    'Red',
    'Green',
    'Yellow',
    'Blue'
  ];

  readonly structureColours = [
    'White',
    'Black',
    'Red',
    'Green',
    'Yellow',
    'Blue',
    'Orange',
    'Other'
  ];

  readonly signalCharacters = [
    'Fixed (F)',
    'Occulting (Oc)',
    'Group Occulting (Oc(n))',
    'Isophase (Iso)',
    'Flashing (Fl)',
    'Long Flashing (LFl)',
    'Group Flashing (Fl(n))',
    'Composite Group Flashing (Fl(n+m))',
    'Quick (Q)',
    'Group Quick (Q(n))',
    'Interrupted Quick (IQ)',
    'Very Quick (VQ)',
    'Group Very Quick (VQ(n))',
    'Interrupted Very Quick (IVQ)',
    'Ultra Quick (UQ)',
    'Interrupted Ultra Quick (IUQ)',
    'Morse Code (Mo)',
    'Alternating (Al)'
  ];

  readonly topMarks = [
    'None',
    'Cone, point up',
    'Cone, point down',
    'Two cones, points up',
    'Two cones, points down',
    'Two cones, base-to-base',
    'Two cones, point-to-point',
    'Cylinder / Can',
    'Sphere',
    'Two spheres',
    "X-shape (St Andrew's Cross)",
    'Vertical / Perpendicular Cross (Emergency Wreck)'
  ];

  readonly structureTypes = [
    'Fixed',
    'Floating'
  ];

  // Service lifecycle list. This is a project/business classification rather
  // than an IALA-defined AtoN taxonomy.
  readonly purposes = [
    'New Installation',
    'Replacement',
    'Relocation',
    'Modification / Upgrade',
    'Temporary Installation',
    'Permanent Installation',
    'Trial / Testing'
  ];

  readonly manufacturers = [
    { key: 'concrete', label: 'Concrete Structure', icon: '▦' },
    { key: 'chains', label: 'Mooring Chains', icon: '⌘' },
    { key: 'buoys', label: 'Marine Buoy', icon: '♟' },
    { key: 'columns', label: 'Steel Column / Pile', icon: '♜' },
    { key: 'light', label: 'Navigation Light', icon: '☀' }
  ];

  form: UntypedFormGroup;

  constructor(private fb: UntypedFormBuilder) {
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
    if (group.get('structureColour')?.value !== 'Other') {
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
      window.alert('Unsupported file type. Allowed types: JPG, PNG, PDF.');
      input.value = '';
      return;
    }

    if (file.size > this.maxFileSize) {
      window.alert('Maximum file size is 5 MB.');
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
