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

  readonly navigationAidTypes = [
    'عوامة ملاحية',
    'منارة بحرية',
    'علامة نهارية',
    'علامة قطاعية',
    'ضوء قطاعي',
    'ضوء نطاقي',
    'ضوء إرشادي',
    'ضوء ميناء',
    'ضوء جسر',
    'علامة مياه آمنة',
    'علامة خطر منعزل',
    'علامة خاصة',
    'علامة جانبية',
    'علامة أصلية',
    'علامة طوارئ / مؤقتة'
  ];

  readonly lightColours = ['أبيض', 'أحمر', 'أخضر', 'أصفر', 'أزرق'];
  readonly structureColours = ['أبيض', 'أحمر', 'أخضر', 'أصفر', 'أسود'];

  readonly signalCharacters = [
    'ثابت',
    'وميض مفرد',
    'وميض جماعي',
    'وميض مركب',
    'وميض سريع',
    'وميض سريع جداً',
    'متساوي الطور',
    'تعتيم',
    'مورس'
  ];

  readonly topMarks = [
    'بدون علامة علوية',
    'مخروط واحد لأعلى',
    'مخروط واحد لأسفل',
    'مخروطان لأعلى',
    'مخروطان متقابلان',
    'كرة واحدة',
    'كرتان',
    'أسطوانة',
    'علامة X'
  ];

  readonly structureTypes = ['ثابت', 'عائم'];
  readonly purposes = ['دائم', 'مؤقت', 'اختبار', 'استبدال مساعد قائم'];

  readonly manufacturers = [
    { key: 'concrete', label: 'الخرسانة الأسمنتية', icon: '▦' },
    { key: 'chains', label: 'السلاسل الحديدية', icon: '⌘' },
    { key: 'buoys', label: 'العوامات البحرية', icon: '♟' },
    { key: 'columns', label: 'الأعمدة الحديدية', icon: '♜' },
    { key: 'light', label: 'النور الملاحي', icon: '☀' }
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
    if (group.get('structureColour')?.value !== 'أخرى') {
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
      window.alert('نوع الملف غير مسموح. المسموح: JPG, PNG, PDF');
      input.value = '';
      return;
    }

    if (file.size > this.maxFileSize) {
      window.alert('الحد الأقصى لحجم الملف هو 5 MB');
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
      count: [1, Validators.required],
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
