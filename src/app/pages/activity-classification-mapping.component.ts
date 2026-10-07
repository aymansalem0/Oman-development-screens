import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LanguageService } from '../services/language.service';

interface ShipCategory {
  id: number;
  nameAr: string;
  nameEn: string;
  allowedAll: boolean;
  isFishing: boolean;
  active: boolean;
}

interface MarineActivity {
  id: number;
  nameAr: string;
  nameEn: string;
  shipCategoryId: number;
  allowIndividuals: boolean;
  active: boolean;
}

interface BusinessActivity {
  id: number;
  activityCode: string;
  nameAr: string;
  nameEn: string;
}

interface MarineActivityMapping {
  id: number;
  marineActivityId: number;
  companyActivityId: number;
}

@Component({
  selector: 'app-activity-classification-mapping',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activity-classification-mapping.component.html',
  styleUrl: './activity-classification-mapping.component.css'
})
export class ActivityClassificationMappingComponent {
  constructor(public lang: LanguageService) {}

  categories: ShipCategory[] = [
    { id: 1, nameAr: 'السفن التجارية', nameEn: 'Commercial Vessels', allowedAll: false, isFishing: false, active: true },
    { id: 2, nameAr: 'قوارب الصيد', nameEn: 'Fishing Vessels', allowedAll: false, isFishing: true, active: true },
    { id: 3, nameAr: 'الوحدات السياحية', nameEn: 'Tourism Marine Units', allowedAll: false, isFishing: false, active: true },
    { id: 4, nameAr: 'القوارب الترفيهية', nameEn: 'Pleasure Crafts', allowedAll: false, isFishing: false, active: true },
    { id: 5, nameAr: 'وحدات الخدمات البحرية', nameEn: 'Marine Service Units', allowedAll: true, isFishing: false, active: true }
  ];

  marineActivities: MarineActivity[] = [
    { id: 101, nameAr: 'نقل البضائع بحراً', nameEn: 'Sea Freight Transport', shipCategoryId: 1, allowIndividuals: false, active: true },
    { id: 102, nameAr: 'نقل الركاب بحراً', nameEn: 'Sea Passenger Transport', shipCategoryId: 1, allowIndividuals: false, active: true },
    { id: 103, nameAr: 'الصيد التجاري', nameEn: 'Commercial Fishing', shipCategoryId: 2, allowIndividuals: true, active: true },
    { id: 104, nameAr: 'الرحلات البحرية السياحية', nameEn: 'Marine Tourism Trips', shipCategoryId: 3, allowIndividuals: true, active: true },
    { id: 105, nameAr: 'تأجير القوارب الترفيهية', nameEn: 'Pleasure Craft Rental', shipCategoryId: 4, allowIndividuals: true, active: true },
    { id: 106, nameAr: 'الخدمات البحرية المساندة', nameEn: 'Marine Support Services', shipCategoryId: 5, allowIndividuals: false, active: true }
  ];

  businessActivities: BusinessActivity[] = [
    { id: 2001, activityCode: '501101', nameAr: 'النقل البحري للبضائع', nameEn: 'Sea and coastal freight water transport' },
    { id: 2002, activityCode: '501201', nameAr: 'النقل البحري للركاب', nameEn: 'Sea and coastal passenger water transport' },
    { id: 2003, activityCode: '031101', nameAr: 'الصيد البحري التجاري', nameEn: 'Marine commercial fishing' },
    { id: 2004, activityCode: '501202', nameAr: 'الرحلات البحرية والسياحية', nameEn: 'Marine passenger and tourism trips' },
    { id: 2005, activityCode: '772104', nameAr: 'تأجير القوارب ومعدات الترفيه البحري', nameEn: 'Rental of boats and marine recreation equipment' },
    { id: 2006, activityCode: '522204', nameAr: 'أنشطة الخدمات المساندة للنقل البحري', nameEn: 'Service activities incidental to water transportation' },
    { id: 2007, activityCode: '331501', nameAr: 'إصلاح وصيانة السفن والقوارب', nameEn: 'Repair and maintenance of ships and boats' },
    { id: 2008, activityCode: '301101', nameAr: 'بناء السفن والهياكل العائمة', nameEn: 'Building of ships and floating structures' }
  ];

  mappings: MarineActivityMapping[] = [
    { id: 1, marineActivityId: 101, companyActivityId: 2001 },
    { id: 2, marineActivityId: 102, companyActivityId: 2002 },
    { id: 3, marineActivityId: 103, companyActivityId: 2003 },
    { id: 4, marineActivityId: 104, companyActivityId: 2004 },
    { id: 5, marineActivityId: 105, companyActivityId: 2005 },
    { id: 6, marineActivityId: 106, companyActivityId: 2006 }
  ];

  categoryForm = {
    id: null as number | null,
    nameAr: '',
    nameEn: '',
    allowedAll: false,
    isFishing: false,
    active: true
  };

  marineActivityForm = {
    id: null as number | null,
    nameAr: '',
    nameEn: '',
    shipCategoryId: null as number | null,
    allowIndividuals: false,
    active: true
  };

  selectedMarineActivityId: number | null = null;
  selectedBusinessActivityId: number | null = null;
  businessActivitySearch = '';
  mappingFilter = '';
  categoryFilter: number | null = null;
  toast = '';

  get filteredBusinessActivities(): BusinessActivity[] {
    const search = this.businessActivitySearch.trim().toLowerCase();
    if (!search) return this.businessActivities;

    return this.businessActivities.filter(item =>
      item.activityCode.toLowerCase().includes(search) ||
      item.nameAr.toLowerCase().includes(search) ||
      item.nameEn.toLowerCase().includes(search)
    );
  }

  get filteredMappings(): MarineActivityMapping[] {
    const search = this.mappingFilter.trim().toLowerCase();

    return this.mappings.filter(mapping => {
      const marine = this.getMarineActivity(mapping.marineActivityId);
      const category = marine ? this.getCategory(marine.shipCategoryId) : undefined;
      const business = this.getBusinessActivity(mapping.companyActivityId);

      if (this.categoryFilter && marine?.shipCategoryId !== this.categoryFilter) {
        return false;
      }

      if (!search) return true;

      return [
        marine?.nameAr,
        marine?.nameEn,
        category?.nameAr,
        category?.nameEn,
        business?.activityCode,
        business?.nameAr,
        business?.nameEn
      ].some(value => value?.toLowerCase().includes(search));
    });
  }

  get selectedMarineActivity(): MarineActivity | undefined {
    if (this.selectedMarineActivityId === null) return undefined;
    return this.getMarineActivity(this.selectedMarineActivityId);
  }

  get selectedBusinessActivity(): BusinessActivity | undefined {
    if (this.selectedBusinessActivityId === null) return undefined;
    return this.getBusinessActivity(this.selectedBusinessActivityId);
  }

  saveCategory(): void {
    const nameAr = this.categoryForm.nameAr.trim();
    const nameEn = this.categoryForm.nameEn.trim();

    if (!nameAr || !nameEn) {
      this.showToast(this.lang.pick('Please enter Arabic and English category names.', 'يرجى إدخال اسم التصنيف بالعربية والإنجليزية.'));
      return;
    }

    if (this.categoryForm.id !== null) {
      const current = this.getCategory(this.categoryForm.id);
      if (current) {
        current.nameAr = nameAr;
        current.nameEn = nameEn;
        current.allowedAll = this.categoryForm.allowedAll;
        current.isFishing = this.categoryForm.isFishing;
        current.active = this.categoryForm.active;
      }
      this.showToast(this.lang.pick('Category updated successfully.', 'تم تحديث التصنيف بنجاح.'));
    } else {
      this.categories.push({
        id: this.nextId(this.categories.map(item => item.id)),
        nameAr,
        nameEn,
        allowedAll: this.categoryForm.allowedAll,
        isFishing: this.categoryForm.isFishing,
        active: this.categoryForm.active
      });
      this.showToast(this.lang.pick('Category added successfully.', 'تمت إضافة التصنيف بنجاح.'));
    }

    this.resetCategoryForm();
  }

  editCategory(category: ShipCategory): void {
    this.categoryForm = {
      id: category.id,
      nameAr: category.nameAr,
      nameEn: category.nameEn,
      allowedAll: category.allowedAll,
      isFishing: category.isFishing,
      active: category.active
    };
  }

  resetCategoryForm(): void {
    this.categoryForm = {
      id: null,
      nameAr: '',
      nameEn: '',
      allowedAll: false,
      isFishing: false,
      active: true
    };
  }

  saveMarineActivity(): void {
    const nameAr = this.marineActivityForm.nameAr.trim();
    const nameEn = this.marineActivityForm.nameEn.trim();

    if (!nameAr || !nameEn || this.marineActivityForm.shipCategoryId === null) {
      this.showToast(this.lang.pick('Complete the category and marine activity names first.', 'أكمل التصنيف واسم النشاط البحري أولاً.'));
      return;
    }

    if (this.marineActivityForm.id !== null) {
      const current = this.getMarineActivity(this.marineActivityForm.id);
      if (current) {
        current.nameAr = nameAr;
        current.nameEn = nameEn;
        current.shipCategoryId = this.marineActivityForm.shipCategoryId;
        current.allowIndividuals = this.marineActivityForm.allowIndividuals;
        current.active = this.marineActivityForm.active;
      }
      this.showToast(this.lang.pick('Marine activity updated successfully.', 'تم تحديث النشاط البحري بنجاح.'));
    } else {
      this.marineActivities.push({
        id: this.nextId(this.marineActivities.map(item => item.id)),
        nameAr,
        nameEn,
        shipCategoryId: this.marineActivityForm.shipCategoryId,
        allowIndividuals: this.marineActivityForm.allowIndividuals,
        active: this.marineActivityForm.active
      });
      this.showToast(this.lang.pick('Marine activity added successfully.', 'تمت إضافة النشاط البحري بنجاح.'));
    }

    this.resetMarineActivityForm();
  }

  editMarineActivity(activity: MarineActivity): void {
    this.marineActivityForm = {
      id: activity.id,
      nameAr: activity.nameAr,
      nameEn: activity.nameEn,
      shipCategoryId: activity.shipCategoryId,
      allowIndividuals: activity.allowIndividuals,
      active: activity.active
    };
  }

  resetMarineActivityForm(): void {
    this.marineActivityForm = {
      id: null,
      nameAr: '',
      nameEn: '',
      shipCategoryId: null,
      allowIndividuals: false,
      active: true
    };
  }

  selectBusinessActivity(activity: BusinessActivity): void {
    this.selectedBusinessActivityId = activity.id;
  }

  saveMapping(): void {
    if (this.selectedMarineActivityId === null || this.selectedBusinessActivityId === null) {
      this.showToast(this.lang.pick('Select a marine activity and an Oman Business activity.', 'اختر النشاط البحري والنشاط التجاري من منصة عُمان للأعمال.'));
      return;
    }

    const existing = this.mappings.find(item => item.marineActivityId === this.selectedMarineActivityId);

    if (existing) {
      existing.companyActivityId = this.selectedBusinessActivityId;
      this.showToast(this.lang.pick('Mapping updated successfully.', 'تم تحديث الربط بنجاح.'));
    } else {
      this.mappings.push({
        id: this.nextId(this.mappings.map(item => item.id)),
        marineActivityId: this.selectedMarineActivityId,
        companyActivityId: this.selectedBusinessActivityId
      });
      this.showToast(this.lang.pick('Mapping created successfully.', 'تم إنشاء الربط بنجاح.'));
    }

    this.selectedMarineActivityId = null;
    this.selectedBusinessActivityId = null;
    this.businessActivitySearch = '';
  }

  editMapping(mapping: MarineActivityMapping): void {
    this.selectedMarineActivityId = mapping.marineActivityId;
    this.selectedBusinessActivityId = mapping.companyActivityId;
    const business = this.getBusinessActivity(mapping.companyActivityId);
    this.businessActivitySearch = business?.activityCode ?? '';
  }

  removeMapping(mapping: MarineActivityMapping): void {
    this.mappings = this.mappings.filter(item => item.id !== mapping.id);
    this.showToast(this.lang.pick('Mapping removed.', 'تم إلغاء الربط.'));
  }

  getCategory(id: number): ShipCategory | undefined {
    return this.categories.find(item => item.id === id);
  }

  getMarineActivity(id: number): MarineActivity | undefined {
    return this.marineActivities.find(item => item.id === id);
  }

  getBusinessActivity(id: number): BusinessActivity | undefined {
    return this.businessActivities.find(item => item.id === id);
  }

  categoryName(category: ShipCategory | undefined): string {
    if (!category) return '--';
    return this.lang.pick(category.nameEn, category.nameAr);
  }

  marineActivityName(activity: MarineActivity | undefined): string {
    if (!activity) return '--';
    return this.lang.pick(activity.nameEn, activity.nameAr);
  }

  businessActivityName(activity: BusinessActivity | undefined): string {
    if (!activity) return '--';
    return this.lang.pick(activity.nameEn, activity.nameAr);
  }

  trackById(_index: number, item: { id: number }): number {
    return item.id;
  }

  private nextId(ids: number[]): number {
    return (ids.length ? Math.max(...ids) : 0) + 1;
  }

  private showToast(message: string): void {
    this.toast = message;
    window.setTimeout(() => {
      if (this.toast === message) this.toast = '';
    }, 2800);
  }
}
