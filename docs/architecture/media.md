# Media

Moved verbatim from `CLAUDE.md`. Paths in links are relative to this folder.

### Media

Images only (JPG/PNG/GIF/WebP — `isSupportedMediaType`), stored as `Blob` in the `mediaAssets` table. Uploads go through [media-actions.ts](../../src/db/media-actions.ts), which deletes orphaned assets when the last referencing exercise drops them. Rendering uses `URL.createObjectURL` with revoke on cleanup ([ExerciseMedia.tsx](../../src/components/ExerciseMedia.tsx)). Export serializes blobs to data URLs and back.

The picture belongs to the exercise form, not to a second step afterwards: `createExercise(input, media?)` writes asset and exercise in **one** transaction, so a rejected image never leaves a half-created exercise behind. Everything that stores an image calls `prepareMediaAsset` **before** opening the transaction — it validates the type and runs `toStorableBlob`, which reads the `File` into memory. WebKit stores a file input's `File` only as a reference and aborts the transaction with "Error preparing Blob/File data to be stored in object store" otherwise; the read has to happen outside, because an `await` on anything but Dexie closes the transaction. Playwright's WebKit refuses blob writes to IndexedDB entirely (verified against plain `indexedDB`, no app involved), so e2e can only cover the form up to the save — the database path is covered by `exercise-actions.test.ts`.
