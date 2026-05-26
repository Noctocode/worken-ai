import { BadRequestException } from '@nestjs/common';
import {
  isUploadAllowed,
  uploadFileFilter,
  UPLOAD_ALLOWED_LABEL,
} from './upload-allowlist.js';

/**
 * The upload allowlist is the user-visible contract for what can be
 * dropped into the knowledge ingestion pipeline. After OCR was
 * removed from the app, the pipeline can only produce searchable
 * text from Word, Excel and PDF, so anything else MUST be rejected
 * at the controller boundary — otherwise the file lands as a `failed`
 * row with a misleading "Skipped" badge.
 *
 * These tests freeze that contract:
 *   - allowed: .doc, .docx, .xls, .xlsx, .pdf with their canonical
 *     mimes plus `application/octet-stream` (some browsers send that)
 *   - rejected: every image format (PNG, JPG, JPEG, GIF, WebP),
 *     plus a few other obvious non-document formats (.zip, .mp4)
 *   - rejected on mismatch: matching extension with the wrong mime
 *     (defends against a curl payload that lies about its body)
 */
describe('upload-allowlist', () => {
  describe('isUploadAllowed', () => {
    const ALLOWED: Array<[string, string]> = [
      ['report.pdf', 'application/pdf'],
      [
        'notes.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      [
        'sheet.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      ['old.xls', 'application/vnd.ms-excel'],
      // `application/octet-stream` is in the mime allowlist because some
      // browsers and curl-without-mimetype send it for office docs.
      ['report.pdf', 'application/octet-stream'],
      ['notes.docx', 'application/octet-stream'],
    ];

    it.each(ALLOWED)('accepts %s (%s)', (name, mime) => {
      expect(isUploadAllowed(name, mime)).toBe(true);
    });

    const REJECTED_IMAGES: Array<[string, string]> = [
      ['scan.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['cover.JPEG', 'image/jpeg'],
      ['art.gif', 'image/gif'],
      ['screenshot.webp', 'image/webp'],
    ];

    it.each(REJECTED_IMAGES)(
      'rejects image upload %s (%s) — OCR has been removed',
      (name, mime) => {
        expect(isUploadAllowed(name, mime)).toBe(false);
      },
    );

    const REJECTED_OTHER: Array<[string, string]> = [
      ['archive.zip', 'application/zip'],
      ['video.mp4', 'video/mp4'],
      ['readme.txt', 'text/plain'],
      ['data.csv', 'text/csv'],
      // Extension is fine, mime is wrong — must still reject.
      ['report.pdf', 'image/png'],
      // Mime is in the allowlist, extension isn't — must still reject.
      ['secret.exe', 'application/pdf'],
      // Legacy Word .doc is not accepted: `mammoth` is .docx-only and
      // accepting .doc here would end with a misleading "Skipped"
      // badge — the very UX bug the allowlist exists to eliminate.
      ['legacy.doc', 'application/msword'],
    ];

    it.each(REJECTED_OTHER)('rejects %s (%s)', (name, mime) => {
      expect(isUploadAllowed(name, mime)).toBe(false);
    });

    it('is case-insensitive on the extension', () => {
      expect(isUploadAllowed('REPORT.PDF', 'application/pdf')).toBe(true);
      expect(isUploadAllowed('Notes.DocX', 'application/octet-stream')).toBe(
        true,
      );
    });

    it('rejects a name without an extension', () => {
      expect(isUploadAllowed('report', 'application/pdf')).toBe(false);
    });
  });

  describe('uploadFileFilter', () => {
    it('calls cb(null, true) for an allowed file', () => {
      const cb = jest.fn();
      uploadFileFilter(
        null,
        { originalname: 'report.pdf', mimetype: 'application/pdf' },
        cb,
      );
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rejects an image with a BadRequestException carrying the allowlist label', () => {
      const cb = jest.fn();
      uploadFileFilter(
        null,
        { originalname: 'scan.png', mimetype: 'image/png' },
        cb,
      );
      expect(cb).toHaveBeenCalledTimes(1);
      const [err, accept] = cb.mock.calls[0] as [unknown, boolean];
      expect(accept).toBe(false);
      expect(err).toBeInstanceOf(BadRequestException);
      // The user-visible message must name the offending file AND
      // recite what IS allowed — debugging an upload failure with
      // only "Unsupported file type" was the original UX bug.
      const message = (err as BadRequestException).message;
      expect(message).toContain('scan.png');
      expect(message).toContain(UPLOAD_ALLOWED_LABEL);
    });
  });
});
