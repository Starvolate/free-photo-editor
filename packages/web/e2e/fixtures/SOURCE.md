# mug.jpg: a test photo for the AI browser test (never part of the app)

- Source: https://commons.wikimedia.org/wiki/File:Mug_image.jpg
- Author: Mohanraj55
- Licence: CC0 1.0 (public domain dedication), as the file's Commons page states (checked 13 Nov 2026)
- This copy: the Commons 640 px rendition (480 x 640), re-saved as JPEG, 61,840 bytes
- Shows: a plastic jug on a dark red patterned cloth; no person
- Used by `packages/web/e2e/ai.e2e.test.ts`. `mug.png` is the same photo made smaller (360 x 480) with macOS `sips -Z 480 -s format png`,
  as a PNG so the Node tests can read it: used by `packages/web/test/align.test.ts` and `packages/web/e2e/automate.e2e.test.ts`. It sits outside `src/` and `public/`, so it is never in the built app.
- The test's regions (two on the jug, two on the cloth) and its bar (jug at least 179 of 255, cloth at most 38) were fixed
  before any model ran on the photo.
