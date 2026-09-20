import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { LanguageService } from '../services/language.service';

interface CalendarDay {
  day: number;
  date: string;
}

interface CalendarMonth {
  monthIndex: number;
  days: Array<CalendarDay | null>;
}

@Component({
  selector: 'app-yearly-availability',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './yearly-availability.component.html',
  styleUrl: './yearly-availability.component.css'
})
export class YearlyAvailabilityComponent implements OnInit {
  private readonly storageKey = 'oman-yearly-appointment-availability';

  currentYear = new Date().getFullYear();
  months: CalendarMonth[] = [];
  selectedDate = '';
  availability: Record<string, string[]> = {};
  customerSelectedDate = '';
  customerSelectedSlot = '';
  saveMessage = '';
  dateWarning = '';
  private hasSelectedDateInteraction = false;

  readonly weekDaysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly weekDaysAr = ['أحد', 'إث', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

  readonly timeSlots = Array.from({ length: 10 }, (_, index) => {
    const hour = index + 8;
    return String(hour).padStart(2, '0') + ':00';
  });

  constructor(public lang: LanguageService) {}

  ngOnInit(): void {
    this.loadAvailability();
    this.buildYear();
    this.selectedDate = this.initialSelectedDate();
    this.syncCustomerSelection();
  }

  get weekDays(): string[] {
    return this.lang.isArabic ? this.weekDaysAr : this.weekDaysEn;
  }

  get configuredDays(): number {
    return this.availableDates.length;
  }

  get totalSlots(): number {
    return this.availableDates.reduce(
      (total, date) => total + (this.availability[date]?.length ?? 0),
      0
    );
  }

  get availableDates(): string[] {
    const prefix = String(this.currentYear) + '-';

    return Object.keys(this.availability)
      .filter(
        date =>
          date.startsWith(prefix) &&
          (this.availability[date]?.length ?? 0) > 0
      )
      .sort();
  }

  get selectedSlots(): string[] {
    return this.availability[this.selectedDate] ?? [];
  }

  get customerSlots(): string[] {
    return this.availability[this.customerSelectedDate] ?? [];
  }

  previousYear(): void {
    this.currentYear -= 1;
    this.changeYear();
  }

  nextYear(): void {
    this.currentYear += 1;
    this.changeYear();
  }

  selectDate(day: CalendarDay): void {
    if (day.date === this.selectedDate) {
      this.hasSelectedDateInteraction = true;
      return;
    }

    const previousDate = this.selectedDate;

    if (
      this.hasSelectedDateInteraction &&
      previousDate &&
      !this.hasSlots(previousDate)
    ) {
      this.dateWarning = this.copy(
        this.displayDate(previousDate) +
          ' was not saved because no time slots were selected.',
        'لم يتم حفظ ' +
          this.displayDate(previousDate) +
          ' لأنه لم يتم تحديد أي توقيتات له.'
      );
    } else {
      this.dateWarning = '';
    }

    this.selectedDate = day.date;
    this.hasSelectedDateInteraction = true;
    this.saveMessage = '';
  }

  toggleSlot(slot: string): void {
    if (!this.selectedDate) return;

    const current = [...(this.availability[this.selectedDate] ?? [])];
    const existingIndex = current.indexOf(slot);

    if (existingIndex >= 0) {
      current.splice(existingIndex, 1);
    } else {
      current.push(slot);
      current.sort();
    }

    if (current.length === 0) {
      delete this.availability[this.selectedDate];
    } else {
      this.availability[this.selectedDate] = current;
    }

    this.persistAvailability();
    this.syncCustomerSelection();
    this.saveMessage = '';
    this.dateWarning = '';
  }

  isSlotSelected(slot: string): boolean {
    return this.selectedSlots.includes(slot);
  }

  hasSlots(date: string): boolean {
    return (this.availability[date]?.length ?? 0) > 0;
  }

  slotCount(date: string): number {
    return this.availability[date]?.length ?? 0;
  }

  selectAllSlots(): void {
    if (!this.selectedDate) return;

    this.availability[this.selectedDate] = [...this.timeSlots];
    this.persistAvailability();
    this.syncCustomerSelection();
    this.saveMessage = '';
    this.dateWarning = '';
  }

  clearSelectedDay(): void {
    if (!this.selectedDate) return;

    delete this.availability[this.selectedDate];
    this.persistAvailability();
    this.syncCustomerSelection();
    this.saveMessage = '';
  }

  saveAvailability(): void {
    this.persistAvailability();
    this.saveMessage = this.copy(
      'Availability saved for this prototype.',
      'تم حفظ المواعيد في النسخة التجريبية.'
    );
  }

  selectCustomerDate(date: string): void {
    this.customerSelectedDate = date;
    this.customerSelectedSlot = '';
  }

  selectCustomerSlot(slot: string): void {
    this.customerSelectedSlot = slot;
  }

  monthLabel(monthIndex: number): string {
    return new Intl.DateTimeFormat(
      this.lang.isArabic ? 'ar-OM' : 'en-GB',
      { month: 'long' }
    ).format(new Date(this.currentYear, monthIndex, 1));
  }

  displayDate(date: string): string {
    if (!date) return '--';

    const [year, month, day] = date.split('-').map(Number);

    return new Intl.DateTimeFormat(
      this.lang.isArabic ? 'ar-OM' : 'en-GB',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }
    ).format(new Date(year, month - 1, day));
  }

  slotRange(slot: string): string {
    const hour = Number(slot.substring(0, 2));
    const endHour = String((hour + 1) % 24).padStart(2, '0');
    return slot + ' – ' + endHour + ':00';
  }

  copy(en: string, ar: string): string {
    return this.lang.isArabic ? ar : en;
  }

  private changeYear(): void {
    this.buildYear();
    this.selectedDate = this.formatDate(this.currentYear, 0, 1);
    this.customerSelectedDate = '';
    this.customerSelectedSlot = '';
    this.syncCustomerSelection();
    this.saveMessage = '';
  }

  private buildYear(): void {
    this.months = Array.from({ length: 12 }, (_, monthIndex) => {
      const firstWeekDay = new Date(this.currentYear, monthIndex, 1).getDay();
      const daysInMonth = new Date(this.currentYear, monthIndex + 1, 0).getDate();
      const days: Array<CalendarDay | null> = [];

      for (let index = 0; index < firstWeekDay; index += 1) {
        days.push(null);
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        days.push({
          day,
          date: this.formatDate(this.currentYear, monthIndex, day)
        });
      }

      return { monthIndex, days };
    });
  }

  private initialSelectedDate(): string {
    const today = new Date();

    if (today.getFullYear() === this.currentYear) {
      return this.formatDate(
        this.currentYear,
        today.getMonth(),
        today.getDate()
      );
    }

    return this.formatDate(this.currentYear, 0, 1);
  }

  private syncCustomerSelection(): void {
    const dates = this.availableDates;

    if (
      this.customerSelectedDate &&
      dates.includes(this.customerSelectedDate)
    ) {
      if (
        this.customerSelectedSlot &&
        !this.customerSlots.includes(this.customerSelectedSlot)
      ) {
        this.customerSelectedSlot = '';
      }
      return;
    }

    this.customerSelectedDate = dates[0] ?? '';
    this.customerSelectedSlot = '';
  }

  private formatDate(year: number, monthIndex: number, day: number): string {
    return (
      String(year) +
      '-' +
      String(monthIndex + 1).padStart(2, '0') +
      '-' +
      String(day).padStart(2, '0')
    );
  }

  private loadAvailability(): void {
    try {
      const saved = localStorage.getItem(this.storageKey);
      this.availability = saved ? JSON.parse(saved) : {};
    } catch {
      this.availability = {};
    }
  }

  private persistAvailability(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.availability));
  }
}
