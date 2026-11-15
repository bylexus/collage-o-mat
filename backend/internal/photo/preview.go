package photo

import (
	"bytes"
	"image"
	_ "image/jpeg" // registers the JPEG decoder for image.DecodeConfig
	"io"
	"mime"

	_ "golang.org/x/image/webp" // registers the WebP decoder for image.DecodeConfig

	"collageomat/internal/apperr"
)

// maxPreviewBytes limits the size of one downloaded image (preview or
// original, see readOriginal). Immich previews (about 1440 px) are a few
// hundred KB.
const maxPreviewBytes = 50 << 20 // 50 MiB

// imageFormat describes an accepted preview image type.
type imageFormat struct {
	ext    string // file extension incl. dot
	decode string // format name reported by image.DecodeConfig
}

// previewFormats maps the accepted Content-Types to their format.
var previewFormats = map[string]imageFormat{
	"image/jpeg": {ext: ".jpg", decode: "jpeg"},
	"image/webp": {ext: ".webp", decode: "webp"},
}

// preview is a downloaded and checked preview image.
type preview struct {
	data     []byte
	mimeType string
	ext      string
	width    int
	height   int
}

// readPreview reads a preview image from r and checks it: the Content-Type
// must be JPEG or WebP and the data must be an image of that type. It
// returns an apperr upstream error if the source sent something else.
func readPreview(r io.Reader, contentType string) (preview, error) {
	mimeType, _, _ := mime.ParseMediaType(contentType)
	format, ok := previewFormats[mimeType]
	if !ok {
		return preview{}, apperr.Upstream("unsupported image type %q (expected image/jpeg or image/webp)", contentType)
	}
	data, err := io.ReadAll(io.LimitReader(r, maxPreviewBytes+1))
	if err != nil {
		return preview{}, apperr.Upstream("download failed: %w", err)
	}
	if len(data) > maxPreviewBytes {
		return preview{}, apperr.Upstream("image is larger than %d MiB", maxPreviewBytes>>20)
	}
	cfg, decoded, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return preview{}, apperr.Upstream("unreadable image: %w", err)
	}
	if decoded != format.decode {
		return preview{}, apperr.Upstream("image data is %s, but Content-Type is %s", decoded, mimeType)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return preview{}, apperr.Upstream("image has no pixel size")
	}
	return preview{data: data, mimeType: mimeType, ext: format.ext, width: cfg.Width, height: cfg.Height}, nil
}
