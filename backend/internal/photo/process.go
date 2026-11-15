package photo

import (
	"context"

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
