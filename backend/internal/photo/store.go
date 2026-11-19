package photo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"collageomat/internal/apperr"
	"collageomat/internal/auth"
	"collageomat/internal/db"
	"collageomat/internal/jsoncol"
	"collageomat/internal/quota"
)

// GormStore is the database repository for photos. It is the only part of
// the package that uses GORM. It does not check ownership; the service does.
// All methods join the transaction of ctx, if any (see db.Transactor).
type GormStore struct {
	db *gorm.DB
}

// NewGormStore returns a store that uses db.
func NewGormStore(db *gorm.DB) *GormStore {
	return &GormStore{db: db}
}

// CreateWithFile inserts p and then calls writeFile with p.ID set;
// writeFile sets p.FileName and writes the file (and may set p.SizeBytes).
// Then FileName and SizeBytes are saved.
// All database changes are one transaction: if writeFile or a database step
// fails, no row is left. writeFile is not undone by the store.
//
// If q.Limit > 0, the sum of the sizes of all photos of q.UserID (with p) is
// checked after the last update, still in the transaction. If it is more
// than q.Limit, the transaction is rolled back and a quota.PhotoError
// (apperr conflict) is returned. The check comes after the insert on
// purpose: the insert takes the SQLite write lock, so parallel uploads and
// import workers are serialized and cannot both pass the check. Reading the
// sum first would need a read→write lock upgrade, which in WAL mode fails
// with SQLITE_BUSY_SNAPSHOT that busy_timeout does not retry. It is after
// writeFile (and not right after the insert) because a copied photo knows
// its size only after the copy; one code path serves all callers.
func (s *GormStore) CreateWithFile(ctx context.Context, p *Photo, q Quota, writeFile func(p *Photo) error) error {
	return db.Conn(ctx, s.db).Transaction(func(tx *gorm.DB) error {
		if err := tx.Omit(clause.Associations).Create(p).Error; err != nil {
			return fmt.Errorf("create photo: %w", err)
		}
		if err := writeFile(p); err != nil {
			return err
		}
		// A map writes both values, also a SizeBytes of 0.
		err := tx.Model(p).Updates(map[string]any{"file_name": p.FileName, "size_bytes": p.SizeBytes}).Error
		if err != nil {
			return fmt.Errorf("set file name and size of photo %d: %w", p.ID, err)
		}
		if q.Limit <= 0 {
			return nil
		}
		used, err := usedBytesByUser(tx, q.UserID)
		if err != nil {
			return err
		}
		if used > q.Limit {
			return quota.PhotoError(used-p.SizeBytes, q.Limit, p.SizeBytes)
		}
		return nil
	})
}

// UsedBytesByUser returns the sum of size_bytes of the photos of all
// collages of the user (implements quota.UsedBytes).
func (s *GormStore) UsedBytesByUser(ctx context.Context, userID uint) (int64, error) {
	return usedBytesByUser(db.Conn(ctx, s.db), userID)
}

// UsedBytesAllUsers returns the sum of size_bytes of the photos per user
// id (all users) with one grouped query. Users without photos are missing
// (0 bytes). It implements quota.UsedBytes.
func (s *GormStore) UsedBytesAllUsers(ctx context.Context) (map[uint]int64, error) {
	var rows []struct {
		UserID uint
		Used   int64
	}
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Select("collages.user_id AS user_id, COALESCE(SUM(photos.size_bytes), 0) AS used").
		Joins("JOIN collages ON collages.id = photos.collage_id").
		Group("collages.user_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("sum photo sizes of all users: %w", err)
	}
	used := make(map[uint]int64, len(rows))
	for _, r := range rows {
		used[r.UserID] = r.Used
	}
	return used, nil
}

// usedBytesByUser returns the sum of size_bytes of the photos of all
// collages of the user, read with conn.
func usedBytesByUser(conn *gorm.DB, userID uint) (int64, error) {
	var used int64
	err := conn.Model(&Photo{}).
		Select("COALESCE(SUM(photos.size_bytes), 0)").
		Joins("JOIN collages ON collages.id = photos.collage_id").
		Where("collages.user_id = ?", userID).
		Scan(&used).Error
	if err != nil {
		return 0, fmt.Errorf("sum photo sizes of user %d: %w", userID, err)
	}
	return used, nil
}

// SizeByCollage returns the sum of size_bytes of the photos of a collage.
func (s *GormStore) SizeByCollage(ctx context.Context, collageID uint) (int64, error) {
	var size int64
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Select("COALESCE(SUM(size_bytes), 0)").
		Where("collage_id = ?", collageID).
		Scan(&size).Error
	if err != nil {
		return 0, fmt.Errorf("sum photo sizes of collage %d: %w", collageID, err)
	}
	return size, nil
}

// ListUsers returns the id and username of the user username, or of all
// users (username ascending) if username is "". An unknown username gives
// an error.
func (s *GormStore) ListUsers(ctx context.Context, username string) ([]auth.User, error) {
	q := db.Conn(ctx, s.db).Model(&auth.User{}).Select("id, username").Order("username ASC")
	if username != "" {
		q = q.Where("username = ?", username)
	}
	var users []auth.User
	if err := q.Find(&users).Error; err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	if username != "" && len(users) == 0 {
		return nil, fmt.Errorf("user %q does not exist", username)
	}
	return users, nil
}

// ListByUser returns the id, file name and size of the photos of all
// collages of the user, id ascending.
func (s *GormStore) ListByUser(ctx context.Context, userID uint) ([]Photo, error) {
	var photos []Photo
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Select("photos.id, photos.file_name, photos.size_bytes").
		Joins("JOIN collages ON collages.id = photos.collage_id").
		Where("collages.user_id = ?", userID).
		Order("photos.id ASC").
		Find(&photos).Error
	if err != nil {
		return nil, fmt.Errorf("list photos of user %d: %w", userID, err)
	}
	return photos, nil
}

// UpdateSize sets size_bytes of the photo id. UpdatedAt does not change:
// the photo itself is not changed.
func (s *GormStore) UpdateSize(ctx context.Context, id uint, size int64) error {
	err := db.Conn(ctx, s.db).Model(&Photo{}).Where("id = ?", id).UpdateColumn("size_bytes", size).Error
	if err != nil {
		return fmt.Errorf("set size of photo %d: %w", id, err)
	}
	return nil
}

// FindInCollage returns the photo id of the collage, or apperr.ErrNotFound.
func (s *GormStore) FindInCollage(ctx context.Context, collageID, id uint) (*Photo, error) {
	var p Photo
	err := db.Conn(ctx, s.db).Where("id = ? AND collage_id = ?", id, collageID).Take(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load photo %d: %w", id, err)
	}
	return &p, nil
}

// ListByCollage returns the photos of a collage, id ascending.
func (s *GormStore) ListByCollage(ctx context.Context, collageID uint) ([]Photo, error) {
	var photos []Photo
	err := db.Conn(ctx, s.db).Where("collage_id = ?", collageID).Order("id ASC").Find(&photos).Error
	if err != nil {
		return nil, fmt.Errorf("list photos of collage %d: %w", collageID, err)
	}
	return photos, nil
}

// ExistingSourceAssetIDs returns those of assetIDs that are already in the
// collage from the connector.
func (s *GormStore) ExistingSourceAssetIDs(ctx context.Context, collageID, connectorID uint, assetIDs []string) ([]string, error) {
	var existing []string
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Where("collage_id = ? AND connector_id = ? AND source_asset_id IN ?", collageID, connectorID, assetIDs).
		Pluck("source_asset_id", &existing).Error
	if err != nil {
		return nil, fmt.Errorf("find imported assets of collage %d: %w", collageID, err)
	}
	return existing, nil
}

// UploadExists reports whether the collage has a photo without connector
// (an upload) with the source asset ID.
func (s *GormStore) UploadExists(ctx context.Context, collageID uint, sourceAssetID string) (bool, error) {
	var count int64
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Where("collage_id = ? AND connector_id IS NULL AND source_asset_id = ?", collageID, sourceAssetID).
		Limit(1).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("find upload in collage %d: %w", collageID, err)
	}
	return count > 0, nil
}

// CollageStats is the number of photos of a collage and the sum of their
// size_bytes.
type CollageStats struct {
	Count     int
	SizeBytes int64
}

// StatsByCollages returns the number and the size sum of the photos per
// collage id (one grouped query); collages without photos are missing in
// the map.
func (s *GormStore) StatsByCollages(ctx context.Context, collageIDs []uint) (map[uint]CollageStats, error) {
	stats := make(map[uint]CollageStats, len(collageIDs))
	if len(collageIDs) == 0 {
		return stats, nil
	}
	var rows []struct {
		CollageID uint
		Count     int
		SizeBytes int64
	}
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Select("collage_id, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS size_bytes").
		Where("collage_id IN ?", collageIDs).
		Group("collage_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count photos of collages: %w", err)
	}
	for _, r := range rows {
		stats[r.CollageID] = CollageStats{Count: r.Count, SizeBytes: r.SizeBytes}
	}
	return stats, nil
}

// CountAllByCollage returns the number of photos of every collage that has
// photos (all users).
func (s *GormStore) CountAllByCollage(ctx context.Context) (map[uint]int, error) {
	var rows []struct {
		CollageID uint
		Count     int
	}
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Select("collage_id, COUNT(*) AS count").
		Group("collage_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count photos of all collages: %w", err)
	}
	counts := make(map[uint]int, len(rows))
	for _, r := range rows {
		counts[r.CollageID] = r.Count
	}
	return counts, nil
}

// UpdatePropsInCollage sets the props (and UpdatedAt) of the photo id if
// it belongs to the collage. It returns false if there is no such photo.
func (s *GormStore) UpdatePropsInCollage(ctx context.Context, collageID, id uint, props jsoncol.JSON) (bool, error) {
	res := db.Conn(ctx, s.db).Model(&Photo{}).
		Where("id = ? AND collage_id = ?", id, collageID).
		Update("props", props)
	if res.Error != nil {
		return false, fmt.Errorf("update props of photo %d: %w", id, res.Error)
	}
	return res.RowsAffected > 0, nil
}

// Delete deletes the photo row with the given id.
func (s *GormStore) Delete(ctx context.Context, id uint) error {
	if err := db.Conn(ctx, s.db).Delete(&Photo{}, id).Error; err != nil {
		return fmt.Errorf("delete photo %d: %w", id, err)
	}
	return nil
}

// DeleteByCollage deletes all photo rows of a collage.
func (s *GormStore) DeleteByCollage(ctx context.Context, collageID uint) error {
	if err := db.Conn(ctx, s.db).Where("collage_id = ?", collageID).Delete(&Photo{}).Error; err != nil {
		return fmt.Errorf("delete photos of collage %d: %w", collageID, err)
	}
	return nil
}
