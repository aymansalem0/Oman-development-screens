# PSC Quota Settings — Blank Screen After Navigation (UI / Read-only API Fix)

## Reproduction

At `/#/moei/smart-inspection/settings/psc-quotas`, the user screenshot shows
the shared MOEI Maritime Unified Platform header/sidebar and **only**
`Editor key`, `Publisher key`, `Load Published Quota` with a very large
empty content area.

Root cause, verified in PR #59 source: the Angular page used
`<section *ngIf="policy as p">` to hide ALL controls until `load()`
succeeded; `ngOnInit()` was empty; `load()` refused without Editor key;
the published-policy GET endpoint also enforced `EDITOR`.

This behavior made normal read-only Settings look broken, even though the
quota configuration screen and sliders existed in the component.

## Correction

- Automatic GET of **published PSC quota policy** when page opens.
- Read-only `GET /api/si/v1/psc-selection/policy` no longer requires
  Editor credentials. The response contains only the published version,
  configuration, publisher name/date and reason. No secrets.
- **Editor key** is still compulsory for `POST /policy/preview` (no writes).
- **Publisher key** is still compulsory for `POST /policy/publish`,
  `POST /decision`; PSC pool remains Editor-only.
- Move key inputs **below** the visible quota scope/percentage sliders,
  close to the protected preview/publish actions; explicit Refresh Published
  Policy in the page header.
- Display an actionable message if initial policy read fails, including
  missing Oracle migration `012`, instead of a blank page.
- Publish success now updates the policy/version and success banner without
  immediately erasing success with another load.
- Same platform header/footer, navigation, language toggle and RTL/LTR.

## Deployment / Database

**NO NEW DATABASE MIGRATION IN THIS FIX.** The prerequisite PR #59 added
Oracle migration **012**. If that migration has not been applied, the new
read-only endpoint will properly report `SI_MIGRATION_012_REQUIRED`.

This PR is stacked on #59 and NOT automatically merged or deployed.

### Windows PowerShell checkout

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# Safeguard uncommitted work before switching branches.
git fetch origin pull/60/head:pr-60-psc-quota-auto
git switch pr-60-psc-quota-auto
git branch --show-current
```

### Docker

This fix changes **Angular + API**, so rebuild both:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=100 ai-proxy
```

If your stack uses `compose.google-psc.yaml`, put it between base and
Oracle files in **each** command. Never use `down --volumes`.

### Acceptance

1. Navigate directly to
   `http://localhost:4200/#/moei/smart-inspection/settings/psc-quotas`;
   press Ctrl+Shift+R.
2. **Without entering either key**, the actual **published** quota
   configuration loads, including MONTHLY period, NATIONAL/PER_PORT scope,
   percentage slider and version badge. Default for new POC installs may
   show `15%` nationally; actual published value may differ.
3. Editor / Publisher keys are below the criteria. They do not block
   viewing the policy. Clicking Preview without Editor fails with a
   clear message. Publishing requires Publisher key, valid justification
   and an actual impact preview.
4. Switch to Arabic; labels/slider/numbers remain in the right layout and
   same MOEI header/sidebar/footer.
5. Stop or misconfigure backend in a **test environment**; expect an
   actionable load error, not an empty page. Restore backend afterwards.
6. Refresh and confirm no extra quota versions were published by merely
   viewing the page; NMC assessments / Port Calls unchanged.
7. CI Angular/Node/Docker tests pass; real local browser/migration checks
   must still be performed after deployment.

### Rollback

Checkout the previous reviewed ref (PR #59) and rebuild `ai-proxy nmc`;
no data migration or SQL rollback. Any policy actually published by business
users remains auditable and unchanged.
