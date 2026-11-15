package photo

import (
	"context"
	"fmt"
	"io"

	"collageomat/internal/apperr"
	"collageomat/internal/imaging"
)

const (
	// MaxUploadBytes is the maximum size of one uploaded image file.
	MaxUploadBytes = 50 << 20 // 50 MiB
	// maxUploadEdge is the maximum long edge of a stored upload in pixels.
	// Larger images are downscaled, smaller ones are never upscaled.
	maxUploadEdge = 2560
	// uploadJPEGQuality is the JPEG quality of stored uploads.
	uploadJPEGQuality = 90
	// maxOriginalEdge is the maximum long edge of a stored original import.
	// It is so large that originals are never scaled in practice
	// (imaging.MaxPixels limits the input size).
	maxOriginalEdge = 1 << 16
	// originalJPEGQuality is the JPEG quality of stored original imports.
	originalJPEGQuality = 90
)

// processUpload turns the bytes of an uploaded image of the given decoder
// format (see imaging.Format) into the stored JPEG (see imaging.Process):
// long edge at most maxUploadEdge. It runs when a decode slot of the
// service's limiter is free and stops waiting when ctx is done.
func (s *Service) processUpload(ctx context.Context, data []byte, format string) (preview, error) {
	var res imaging.Result
	err := s.decoder.Do(ctx, func() error {
		var err error
		res, err = imaging.Process(data, format, imaging.Options{
			MaxEdge: maxUploadEdge,
			Quality: uploadJPEGQuality,
		})
		return err
	})
	if err != nil {
		return preview{}, err
	}
	return preview{
		data:     res.Data,
		mimeType: res.MimeType,
		ext:      res.Ext,
		width:    res.Width,
		height:   res.Height,
	}, nil
}

// processOriginal reads an original image of a source (at most
// maxPreviewBytes) and turns it into the stored JPEG (see imaging.Process)
// without scaling. Like processUpload, it runs when a decode slot of the
// service's limiter is free. An image that cannot be read or processed
// gives an apperr upstream error: it is a problem of the source image, not
// of the client's request.
func (s *Service) processOriginal(ctx context.Context, r io.Reader, contentType string) (preview, error) {
	format, err := imaging.Format(contentType)
	if err != nil {
		return preview{}, apperr.Upstream("unsupported image type %q in original size (expected JPEG, PNG or WebP)", contentType)
	}
	data, err := readOriginal(r)
	if err != nil {
		return preview{}, err
	}
	var res imaging.Result
	err = s.decoder.Do(ctx, func() error {
		var err error
		res, err = imaging.Process(data, format, imaging.Options{
			MaxEdge: maxOriginalEdge,
			Quality: originalJPEGQuality,
		})
		return err
	})
	if v, ok := apperr.AsValidation(err); ok {
		return preview{}, apperr.Upstream("%s", v.Message)
	}
	if err != nil {
		return preview{}, fmt.Errorf("process original image: %w", err)
	}
	return preview{
		data:     res.Data,
		mimeType: res.MimeType,
		ext:      res.Ext,
		width:    res.Width,
		height:   res.Height,
	}, nil
}

// readOriginal reads an original image of at most maxPreviewBytes.
func readOriginal(r io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxPreviewBytes+1))
	if err != nil {
		return nil, apperr.Upstream("download failed: %w", err)
	}
	if len(data) > maxPreviewBytes {
		return nil, apperr.Upstream("image is larger than %d MiB", maxPreviewBytes>>20)
	}
	if len(data) == 0 {
		return nil, apperr.Upstream("image is empty")
	}
	return data, nil
}
