package collage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"

	"collageomat/internal/jsoncol"
	"collageomat/internal/quota"
)

// DuplicateResult is the result of Service.Duplicate: the new collage
// (PhotoCount and SizeBytes are those of the copied photos) and the number
// of photos that were not copied because their file is missing.
type DuplicateResult struct {
	Summary
	SkippedPhotos int
}

// Duplicate copies the collage id of the user into a new collage of the
// same user with the given name (validated like Rename). The copy gets the
// settings, all photos (rows with props and a copy of each file) and all
// texts (with new text ids). The photo ids in the settings are changed to
// the ids of the copied photos (see remapSettingsPhotoIDs).
//
// A photo whose file is missing is skipped and counted in SkippedPhotos.
// All other errors fail the whole copy: the database changes are rolled
// back and the photo files of the new collage are removed.
//
// Storage limit: if the used bytes of the user plus the size of the source
// collage's photos are more than the limit, the copy is refused before
// anything is copied (quota.CopyError, apperr conflict). Each copied photo
// is checked again when it is stored (see Photos.CopyAllForCollage).
func (s *Service) Duplicate(ctx context.Context, userID, id uint, name string) (*DuplicateResult, error) {
	name, err := validName(name)
	if err != nil {
		return nil, err
	}
	limit, err := s.checkDuplicateQuota(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	// outerCtx has no transaction: the file cleanup after a rollback must
	// not use the rolled-back transaction.
	outerCtx := ctx
	var (
		result *DuplicateResult
		newID  uint
	)
	err = s.tx.InTx(ctx, func(ctx context.Context) error {
		// Read first, then write: the source settings are needed for the
		// insert. The read-to-write lock upgrade of SQLite can give a busy
		// error under concurrent writes; this is accepted here.
		src, err := s.store.FindForUser(ctx, userID, id)
		if err != nil {
			return err
		}
		c := Collage{UserID: userID, Name: name, Settings: src.Settings}
		if err := s.store.Create(ctx, &c); err != nil {
			return err
		}
		newID = c.ID

		idMap, skipped, err := s.photos.CopyAllForCollage(ctx, src.ID, c.ID, userID, limit)
		if err != nil {
			return fmt.Errorf("copy photos of collage %d to collage %d: %w", src.ID, c.ID, err)
		}
		settings, changed, err := remapSettingsPhotoIDs(src.Settings, idMap)
		if err != nil {
			return fmt.Errorf("remap photo ids in settings of collage %d: %w", src.ID, err)
		}
		if changed {
			if err := s.store.UpdateSettingsForUser(ctx, userID, c.ID, settings); err != nil {
				return err
			}
		}
		if err := s.copyTexts(ctx, src.ID, c.ID); err != nil {
			return err
		}

		// Reload to return the stored settings, timestamps and photo stats.
		copied, err := s.store.FindForUser(ctx, userID, c.ID)
		if err != nil {
			return err
		}
		stats, err := s.photos.StatsByCollages(ctx, []uint{c.ID})
		if err != nil {
			return fmt.Errorf("count photos of collage %d: %w", c.ID, err)
		}
		result = &DuplicateResult{
			Summary:       summary(*copied, stats[c.ID]),
			SkippedPhotos: skipped,
		}
		return nil
	})
	if err != nil {
		if newID != 0 {
			// The rows are rolled back; remove the files written so far.
			if cleanupErr := s.photos.DeleteAllForCollage(outerCtx, newID); cleanupErr != nil {
				slog.Error("duplicate collage: remove files of failed copy",
					"collage", newID, "err", cleanupErr)
			}
		}
		return nil, err
	}
	return result, nil
}

// checkDuplicateQuota checks that a copy of the collage id of the user fits
// into the user's storage limit and returns the limit (0 = unlimited). It
// runs before the transaction of Duplicate, so that the reads do not make
// the read-to-write lock upgrade window of the transaction longer. It is a
// fast fail only; the check per photo in the transaction is the guarantee.
func (s *Service) checkDuplicateQuota(ctx context.Context, userID, id uint) (int64, error) {
	if _, err := s.store.FindForUser(ctx, userID, id); err != nil {
		return 0, err
	}
	used, limit, err := s.quotas.Usage(ctx, userID)
	if err != nil {
		return 0, err
	}
	if limit == 0 {
		return 0, nil
	}
	needed, err := s.photos.SizeByCollage(ctx, id)
	if err != nil {
		return 0, fmt.Errorf("size of collage %d: %w", id, err)
	}
	if quota.Exceeds(used, needed, limit) {
		return 0, quota.CopyError(used, limit, needed)
	}
	return limit, nil
}

// copyTexts copies the texts of collage srcID into collage dstID with new
// text ids and the same props.
func (s *Service) copyTexts(ctx context.Context, srcID, dstID uint) error {
	texts, err := s.store.ListTexts(ctx, srcID)
	if err != nil {
		return err
	}
	rows := make([]CollageText, len(texts))
	for i, t := range texts {
		textID, err := newTextID()
		if err != nil {
			return err
		}
		rows[i] = CollageText{ID: textID, CollageID: dstID, Props: t.Props}
	}
	return s.store.ReplaceTexts(ctx, dstID, rows)
}

// settingsPhotoIDPaths are the paths of the photo ids in the collage
// settings. They mirror the settings model of the frontend
// (frontend/src/app/core/models/collage.ts: CenterSettings.centerPhotoId
// and ImageBackgroundSettings.photoId); a new photo id field there must be
// added here too, else a duplicate keeps the id of the source collage.
var settingsPhotoIDPaths = [][]string{
	{"center", "centerPhotoId"},
	{"background", "image", "photoId"},
}

// remapSettingsPhotoIDs returns settings with the photo ids at
// settingsPhotoIDPaths changed by idMap (old id -> new id). A number that
// is not in idMap becomes null; null stays null; a missing path, or a path
// through a value that is not an object, stays as it is. All other values
// are kept. changed reports whether a value was changed; if not, settings
// is returned as is. settings must be a JSON object.
func remapSettingsPhotoIDs(settings jsoncol.JSON, idMap map[uint]uint) (jsoncol.JSON, bool, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(settings, &root); err != nil {
		return nil, false, fmt.Errorf("decode settings: %w", err)
	}
	changed := false
	for _, p := range settingsPhotoIDPaths {
		c, err := remapPath(root, p, idMap)
		if err != nil {
			return nil, false, err
		}
		changed = changed || c
	}
	if !changed {
		return settings, false, nil
	}
	out, err := jsoncol.From(root)
	if err != nil {
		return nil, false, err
	}
	return out, true, nil
}

// remapPath remaps the photo id at path in obj (see remapSettingsPhotoIDs)
// and reports whether it changed obj.
func remapPath(obj map[string]json.RawMessage, path []string, idMap map[uint]uint) (bool, error) {
	raw, ok := obj[path[0]]
	if !ok {
		return false, nil
	}
	if len(path) > 1 {
		var child map[string]json.RawMessage
		if !jsoncol.JSON(raw).IsObject() || json.Unmarshal(raw, &child) != nil {
			return false, nil
		}
		changed, err := remapPath(child, path[1:], idMap)
		if err != nil || !changed {
			return false, err
		}
		b, err := json.Marshal(child)
		if err != nil {
			return false, fmt.Errorf("encode settings %q: %w", path[0], err)
		}
		obj[path[0]] = b
		return true, nil
	}

	newValue, ok := remapID(raw, idMap)
	if !ok {
		return false, nil
	}
	obj[path[0]] = newValue
	return true, nil
}

// remapID returns the new value for the photo id raw: the mapped id, or
// null for a number that is not in idMap. ok is false if raw is not a
// number (null, string, ...) and stays as it is.
func remapID(raw json.RawMessage, idMap map[uint]uint) (json.RawMessage, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, false
	}
	n, isNumber := v.(json.Number)
	if !isNumber {
		return nil, false
	}
	if old, err := strconv.ParseUint(n.String(), 10, 0); err == nil {
		if newID, found := idMap[uint(old)]; found {
			return json.RawMessage(strconv.FormatUint(uint64(newID), 10)), true
		}
	}
	return json.RawMessage("null"), true
}

// newTextID returns a random UUID version 4 (RFC 4122 variant) in the
// lowercase 8-4-4-4-12 hex form, the same form as the text ids of the
// frontend (crypto.randomUUID).
func newTextID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("make text id: %w", err)
	}
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // variant 10xx (RFC 4122)
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32], nil
}
