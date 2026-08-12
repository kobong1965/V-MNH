# Design QA - v0.5.25

## Source

- User screenshots: image-node note sits above the media card; upload and text controls scale with the image node.
- Existing V-MNH canvas design system in `src/vela/libtv.css` and `src/components/canvas/CanvasNode.tsx`.

## Implementation

- Image annotation is outside and 8 px above the node card.
- Image upload/text actions are normal canvas children, so they scale with their node.
- Workflow panel explicitly reports that images and videos are bundled.
- Workflow list shows both node count and bundled material count.

## Screenshots

- Compared the user screenshot against the local 1280x720 canvas at 100% zoom.
- Verified the note above the image-input node and the compact 70x38 px two-button toolbar inside the node header.
- Verified the workflow panel renders `1 个节点 · 1 个素材` for a bundled test workflow.
- Verified applying the bundled workflow creates a second node and copies the source asset into the target project.

## Result

passed
