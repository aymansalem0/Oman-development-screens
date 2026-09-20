# Oman Development Screens

Angular implementation of the Oman MTCIT **Navigation Aids Installation Approval** screens based on the supplied production screenshots.

## Implemented screens

1. **Requests dashboard / list**
   - Summary KPI cards.
   - Search/status/date filter UI.
   - Requests table and Follow Up navigation.

2. **Request detail / Follow Up**
   - Same request-data layout as the current MTCIT screen.
   - Awaiting Installation Company Review status.
   - Send / Reject actions.
   - Enter Specifications action.

3. **Enter Technical Specifications popup**
   - Exactly **two complete technical specifications**.
   - Each specification has its own **Count (1 / 2)**.
   - Navigation Aid Type dropdown (15 options).
   - The old Type field is removed.
   - Structure Type and Lit.
   - Specification Purpose.
   - Structure Details and Focal Height.
   - Colour of Light: 5-value dropdown.
   - Colour of Structure: 5-value dropdown + Other free text.
   - Proposed Signal Character renamed to Arabic **نوع الوميض**.
   - Nominal Range renamed to **مدى النور الملاحي** with automatic `NM` display suffix.
   - Names / Letters / Numbers renamed to **الأرقام الوطنية المقترحة**.
   - Visible Sector renamed to **مدى زاوية الرؤية** with degree suffix.
   - Top Mark dropdown.
   - Five manufacturer blocks, each with attachment + manufacturer name:
     - الخرسانة الأسمنتية
     - السلاسل الحديدية
     - العوامات البحرية
     - الأعمدة الحديدية
     - النور الملاحي
   - Technical location using DD/MM + N/S and DDD/MM + E/W.
   - Example: `24°30.7′ N, 56°37.8′ E`.
   - JPG / PNG / PDF validation with 5 MB maximum per attachment.

## Routes

- `/dashboard/maritime-navigation/navigation-aids-installation-approval`
- `/dashboard/maritime-navigation/navigation-aids-installation-approval/100`

## Run locally

```bash
npm install
npm start
```

Open: `http://localhost:4200`

## Build

```bash
npm run build
```

A GitHub Actions build workflow is included under `.github/workflows/build.yml`.
