// Package imaging converts uploaded images (JPEG, PNG, WebP) into opaque,
// upright, size-limited JPEGs. It also limits the number of images that are
// decoded at the same time (see DecodeLimiter).
package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // registers the PNG decoder
	"log/slog"
	"mime"

	"github.com/rwcarlsen/goexif/exif"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // registers the WebP decoder

	"collageomat/internal/apperr"
)

// MaxPixels limits width × height of an input image. It is checked before
// the full decode, because a decoded image needs about 4 bytes per pixel
// (60 MP ≈ 240 MB).
const MaxPixels = 60_000_000

// formats maps the accepted Content-Types to the format name reported by
// image.DecodeConfig.
var formats = map[string]string{
	"image/jpeg": "jpeg",
	"image/png":  "png",
	"image/webp": "webp",
}

// errUnsupported is the client message for an image that is not JPEG, PNG
// or WebP.
const errUnsupported = "unsupported image format; use JPEG, PNG or WebP"

// Options controls the output of Process.
type Options struct {
	// MaxEdge is the maximum long edge of the output in pixels. Larger
	// images are downscaled, smaller ones are never upscaled. Must be > 0.
	MaxEdge int
	// Square crops the upright image to its centered square before it is
	// scaled.
	Square bool
	// Quality is the JPEG quality (1–100). 0 uses jpeg.DefaultQuality.
	Quality int
}

// Result is a processed image.
type Result struct {
	// Data is the JPEG file content.
	Data []byte
	// MimeType is always "image/jpeg".
	MimeType string
	// Ext is the file extension, always ".jpg".
	Ext    string
	Width  int
	Height int
}

// Format returns the expected decoder format name ("jpeg", "png" or
// "webp") for the Content-Type of an image, or an apperr validation error.
func Format(contentType string) (string, error) {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return "", apperr.Validation(errUnsupported)
	}
	format, ok := formats[mediaType]
	if !ok {
		return "", apperr.Validation(errUnsupported)
	}
	return format, nil
}

// Process turns the bytes of an image of the given decoder format (see
// Format) into a JPEG: EXIF orientation applied (JPEG only), optionally
// cropped to the centered square, long edge at most opts.MaxEdge,
// transparency on white, all metadata removed. Invalid or unsupported image
// data gives an apperr validation error.
func Process(data []byte, format string, opts Options) (Result, error) {
	if err := checkConfig(data, format); err != nil {
		return Result{}, err
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Result{}, apperr.Validation("unreadable image: %v", err)
	}
	orientation := 1
	if format == "jpeg" {
		orientation = exifOrientation(data)
	}
	area := src.Bounds()
	if opts.Square {
		area = centerSquare(area)
	}
	img := orient(flattenScaled(src, area, opts.MaxEdge), orientation)

	quality := opts.Quality
	if quality == 0 {
		quality = jpeg.DefaultQuality
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return Result{}, fmt.Errorf("encode image as JPEG: %w", err)
	}
	b := img.Bounds()
	return Result{
		Data:     buf.Bytes(),
		MimeType: "image/jpeg",
		Ext:      ".jpg",
		Width:    b.Dx(),
		Height:   b.Dy(),
	}, nil
}

// checkConfig reads the image header only: the data must be an image of the
// expected format with at most MaxPixels pixels.
func checkConfig(data []byte, format string) error {
	cfg, decoded, err := image.DecodeConfig(bytes.NewReader(data))
	if errors.Is(err, image.ErrFormat) {
		return apperr.Validation(errUnsupported)
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
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return apperr.Validation("image has more than %d megapixels", MaxPixels/1_000_000)
	}
	return nil
}

// centerSquare returns the centered square of r. The square of the upright
// image is the same area, because all EXIF orientations keep the center.
func centerSquare(r image.Rectangle) image.Rectangle {
	w, h := r.Dx(), r.Dy()
	s := min(w, h)
	x0 := r.Min.X + (w-s)/2
	y0 := r.Min.Y + (h-s)/2
	return image.Rect(x0, y0, x0+s, y0+s)
}

// flattenScaled draws the area of src onto an opaque white RGBA image with
// its origin at (0, 0), downscaled so that the long edge is at most maxEdge
// (never upscaled). Transparent pixels become white.
func flattenScaled(src image.Image, area image.Rectangle, maxEdge int) *image.RGBA {
	w, h := scaledSize(area.Dx(), area.Dy(), maxEdge)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	if w == area.Dx() && h == area.Dy() {
		draw.Draw(dst, dst.Bounds(), src, area.Min, draw.Over)
	} else {
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, area, draw.Over, nil)
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
			slog.Warn("broken EXIF data in image", "panic", v)
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
