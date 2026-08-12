# v0.5.25 Workflow material bundle

## Goal

Saving a canvas as a reusable workflow must preserve the complete reusable canvas: nodes, groups, connections, annotations, and every locally stored image or video referenced by those nodes.

## User flow

1. The user saves the current project as a named workflow.
2. The backend copies every project-local image/video referenced by the workflow into a private workflow asset bundle.
3. The workflow list reports how many bundled materials it contains.
4. When the user applies the workflow to another project, the backend copies those assets into that target project and rewrites all node media URLs.
5. The new project owns its copies, so deleting the saved workflow later does not break a canvas that already used it.

## Boundaries

- Bundle only Vela project-local media URLs owned by the source project.
- Do not copy API keys, account credentials, remote provider URLs, arbitrary filesystem paths, task errors, or task progress.
- Keep generated nodes idle when reused while retaining their visible bundled media.
- Deleting a workflow deletes its private bundle only; target-project copies remain.

## Acceptance checks

- A workflow containing one uploaded image and one generated image restores both into a different project.
- The restored media bytes match the source media bytes.
- Workflow JSON contains opaque asset tokens, not source project URLs or base64 blobs.
- Notes and image-node quick actions stay visually attached to the image node while zooming.
- Typecheck, server tests, production build, browser QA, native packaging, in-place upgrade, and GitHub release all pass.
