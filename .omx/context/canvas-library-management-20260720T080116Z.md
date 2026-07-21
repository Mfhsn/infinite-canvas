# Canvas Library Management Context

## Task statement

Research and produce an approval-gated implementation plan for upgrading the canvas library to support the reference UI capabilities: project-name search, project-type filtering, folders, moving projects, cover thumbnails, default-project badges, and card overflow actions. No business code changes are allowed before user approval.

## Desired outcome

- A final plan saved under `.omx/plans/`.
- The plan covers code/data/storage migration and UI/UX changes.
- External product and engineering evidence is cited.
- Existing browser/MySQL/WebDAV/import-export data remains backward compatible.
- The user reviews and approves the plan before implementation starts.

## Current repository evidence

- `web/src/pages/canvas/index.tsx` renders all projects directly and has no search, type filter, folder navigation, or folder creation.
- `web/src/stores/canvas/use-canvas-store.ts` persists only `projects: CanvasProject[]`.
- `CanvasProject` has no `folderId`, `projectType`, `coverStorageKey`, or `isDefault` fields.
- `web/src/components/canvas/canvas-project-card.tsx` shows title, node/connection counts, updated time, and direct action buttons; it has no thumbnail or overflow menu.
- MySQL persistence stores each canvas project as a JSON document in `storage_documents`; binary media is stored in `storage_blobs`.
- Browser/MySQL collection order is maintained by a special order document.
- WebDAV sync merges canvas projects by `id` and `updatedAt`.
- ZIP export format is currently version 3 and exports project JSON plus referenced blobs.
- Existing automated tests cover storage repositories and persisted collections, but not canvas-library organization behavior.

## Constraints

- No new dependency unless explicitly justified and approved.
- Preserve existing projects that lack new metadata.
- Support both browser and MySQL storage drivers.
- Preserve WebDAV sync and ZIP import/export behavior.
- Keep Chinese and English UI dictionaries aligned.
- Avoid storing large thumbnail data URLs inside project JSON.
- Do not implement until the user approves the final plan.

## Unknowns to resolve through research and planning

- Flat folders versus nested folders.
- Whether project type is user-selected, inferred, or both.
- Folder deletion behavior for contained projects.
- Default-project uniqueness and scope.
- Thumbnail generation trigger, format, dimensions, and cleanup behavior.
- Whether folders need inclusion in ZIP/WebDAV sync and how conflicts are resolved.

## Likely codebase touchpoints

- `web/src/pages/canvas/index.tsx`
- `web/src/components/canvas/canvas-project-card.tsx`
- `web/src/components/canvas/canvas-delete-projects-dialog.tsx`
- `web/src/stores/canvas/use-canvas-store.ts`
- `web/src/stores/canvas/use-canvas-ui-store.ts`
- `web/src/lib/canvas/canvas-export.ts`
- `web/src/types/canvas-export.ts`
- `web/src/services/app-sync.ts`
- `web/src/services/file-storage.ts`
- `web/src/services/image-storage.ts`
- `web/src/i18n/messages.ts`
- `web/tests/`
- Storage server only if the JSON-document/blob contracts prove insufficient.
