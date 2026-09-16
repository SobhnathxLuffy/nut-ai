# Photo upload privacy

The cloud-inference payload is not assumed to be private merely because Expo ImageManipulator re-encodes the capture.

Before any photo payload is passed to a provider, `apps/mobile/src/scan/orchestrator.ts` now:

1. resizes the image to 1024 px width;
2. encodes it as JPEG;
3. parses the encoded JPEG marker stream;
4. removes APP1–APP15 and COM segments (including EXIF GPS and XMP metadata);
5. validates that none of those metadata segments remain; and
6. passes only that validated Base64 payload to cloud inference.

The compressed image scan is copied without another lossy encoding. The temporary resized file is deleted after extraction. `photo-privacy.test.ts` includes a synthetic JPEG containing EXIF GPS text and verifies that the uploaded payload contains neither the EXIF header nor GPS fields.
