package photo

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder for uploads
	"log/slog"
	"mime"

	"github.com/rwcarlsen/goexif/exif"
	"golang.org/x/image/draw"

	"collageomat/internal/apperr"
)

const (
	// MaxUploadBytes is the maximum size of one uploaded image file.
	MaxUploadBytes = 50 << 20 // 50 MiB
	// maxUploadPixels limits width × height of an uploaded image. It is
	// checked before the full decode, because a decoded image needs about
	// 4 bytes per pixel (60 MP ≈ 240 MB).
	maxUploadPixels = 60_000_000
	// maxUploadEdge is the maximum long edge of a stored upload in pixels.
	// Larger images are downscaled, smaller ones are never upscaled.
	maxUploadEdge = 2560
	// uploadJPEGQuality is the JPEG quality of stored uploads.
	uploadJPEGQuality = 90
	// maxConcurrentDecodes is the server-wide number of uploads that are
	// decoded and processed at the same time.
	maxConcurrentDecodes = 2
)

// uploadFormats maps the accepted upload Content-Types to the format name
// reported by image.DecodeConfig.
var uploadFormats = map[string]string{
	"image/jpeg": "jpeg",
	"image/png":  "png",
	"image/webp": "webp",
}

// errUnsupportedUpload is the client message for an image that is not
// JPEG, PNG or WebP.
const errUnsupportedUpload = "unsupported image format; use JPEG, PNG or WebP"

// uploadFormat returns the expected decoder format name for the
// Content-Type of an upload, or an apperr validation error.
func uploadFormat(contentType string) (string, error) {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return "", apperr.Validation(errUnsupportedUpload)
	}
	format, ok := uploadFormats[mediaType]
	if !ok {
		return "", apperr.Validation(errUnsupportedUpload)
	}
	return format, nil
}

// processUpload turns the bytes of an uploaded image of the given decoder
// format (see uploadFormat) into the stored JPEG: EXIF orientation applied
// (JPEG only), long edge at most maxUploadEdge, transparency on white, all
// metadata removed. Invalid or unsupported image data gives an apperr
// validation error.
func processUpload(data []byte, format string) (preview, error) {
	if err := checkUploadConfig(data, format); err != nil {
		return preview{}, err
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return preview{}, apperr.Validation("unreadable image: %v", err)
	}
	orientation := 1
	if format == "jpeg" {
		orientation = exifOrientation(data)
	}
	img := orient(flattenScaled(src), orientation)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: uploadJPEGQuality}); err != nil {
		return preview{}, fmt.Errorf("encode upload as JPEG: %w", err)
	}
	b := img.Bounds()
	return preview{
		data:     buf.Bytes(),
		mimeType: "image/jpeg",
		ext:      ".jpg",
		width:    b.Dx(),
		height:   b.Dy(),
	}, nil
}

// checkUploadConfig reads the image header only: the data must be an image
// of the expected format with at most maxUploadPixels pixels.
func checkUploadConfig(data []byte, format string) error {
	cfg, decoded, err := image.DecodeConfig(bytes.NewReader(data))
	if errors.Is(err, image.ErrFormat) {
		return apperr.Validation(errUnsupportedUpload)
	}
	if err != nil {
		return apperr.Validation("unreadable image: %v", err)
	}
	if decoded != format {
		return apperr.Validation("image data is %s, but Content-Type is image/%s", decoded, format)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return apperr.Validation("image has no pixel size")
	}
	if int64(cfg.Width)*int64(cfg.Height) > maxUploadPixels {
		return apperr.Validation("image has more than %d megapixels", maxUploadPixels/1_000_000)
	}
	return nil
}

// flattenScaled draws src onto an opaque white RGBA image, downscaled so
// that the long edge is at most maxUploadEdge (never upscaled).
// Transparent pixels become white.
func flattenScaled(src image.Image) *image.RGBA {
	sb := src.Bounds()
	w, h := scaledSize(sb.Dx(), sb.Dy(), maxUploadEdge)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	if w == sb.Dx() && h == sb.Dy() {
		draw.Draw(dst, dst.Bounds(), src, sb.Min, draw.Over)
	} else {
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, sb, draw.Over, nil)
	}
	return dst
}

// scaledSize returns w × h scaled so that the long edge is at most maxEdge,
// keeping the aspect ratio. Sizes within the limit are returned unchanged.
func scaledSize(w, h, maxEdge int) (int, int) {
	long := max(w, h)
	if long <= maxEdge {
		return w, h
	}
	scale := func(v int) int { return max(1, (v*maxEdge+long/2)/long) }
	return scale(w), scale(h)
}

// exifOrientation returns the EXIF orientation (1–8) of JPEG data. Missing
// or broken EXIF data gives 1 (no change).
func exifOrientation(data []byte) (orientation int) {
	orientation = 1
	defer func() {
		// The EXIF library is old and not hardened against broken data.
		if v := recover(); v != nil {
			slog.Warn("broken EXIF data in upload", "panic", v)
			orientation = 1
		}
	}()
	x, err := exif.Decode(bytes.NewReader(data))
	if x == nil {
		return 1
	}
	_ = err // a non-critical error still gives usable tags
	tag, err := x.Get(exif.Orientation)
	if err != nil {
		return 1
	}
	v, err := tag.Int(0)
	if err != nil || v < 1 || v > 8 {
		return 1
	}
	return v
}

// orient returns img transformed so that it is shown upright for the given
// EXIF orientation:
//
//	1 unchanged             5 transpose (mirror on the main diagonal)
//	2 mirror horizontally   6 rotate 90° clockwise
//	3 rotate 180°           7 transverse (mirror on the other diagonal)
//	4 mirror vertically     8 rotate 90° counter-clockwise
//
// img must have its origin at (0, 0).
func orient(img *image.RGBA, orientation int) *image.RGBA {
	if orientation < 2 || orientation > 8 {
		return img
	}
	w, h := img.Rect.Dx(), img.Rect.Dy()
	dw, dh := w, h
	if orientation >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for dy := range dh {
		for dx := range dw {
			sx, sy := sourcePixel(orientation, dx, dy, w, h)
			si := sy*img.Stride + sx*4
			di := dy*dst.Stride + dx*4
			copy(dst.Pix[di:di+4], img.Pix[si:si+4])
		}
	}
	return dst
}

// sourcePixel returns the pixel of the w × h source image that is shown at
// (dx, dy) of the upright image for the given EXIF orientation (2–8).
func sourcePixel(orientation, dx, dy, w, h int) (int, int) {
	switch orientation {
	case 2:
		return w - 1 - dx, dy
	case 3:
		return w - 1 - dx, h - 1 - dy
	case 4:
		return dx, h - 1 - dy
	case 5:
		return dy, dx
	case 6:
		return dy, h - 1 - dx
	case 7:
		return w - 1 - dy, h - 1 - dx
	default: // 8
		return w - 1 - dy, dx
	}
}
