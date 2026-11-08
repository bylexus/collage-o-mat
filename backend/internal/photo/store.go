package photo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"collageomat/internal/apperr"
	"collageomat/internal/db"
	"collageomat/internal/jsoncol"
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
// writeFile sets p.FileName and writes the file. Then FileName is saved.
// All database changes are one transaction: if writeFile or a database step
// fails, no row is left. writeFile is not undone by the store.
func (s *GormStore) CreateWithFile(ctx context.Context, p *Photo, writeFile func(p *Photo) error) error {
	return db.Conn(ctx, s.db).Transaction(func(tx *gorm.DB) error {
		if err := tx.Omit(clause.Associations).Create(p).Error; err != nil {
			return fmt.Errorf("create photo: %w", err)
		}
		if err := writeFile(p); err != nil {
			return err
		}
		if err := tx.Model(p).Update("file_name", p.FileName).Error; err != nil {
			return fmt.Errorf("set file name of photo %d: %w", p.ID, err)
		}
		return nil
	})
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

// CountByCollages returns the number of photos per collage id; collages
// without photos are missing in the map.
func (s *GormStore) CountByCollages(ctx context.Context, collageIDs []uint) (map[uint]int, error) {
	counts := make(map[uint]int, len(collageIDs))
	if len(collageIDs) == 0 {
		return counts, nil
	}
	var rows []struct {
		CollageID uint
		Count     int
	}
	err := db.Conn(ctx, s.db).Model(&Photo{}).
		Select("collage_id, COUNT(*) AS count").
		Where("collage_id IN ?", collageIDs).
		Group("collage_id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count photos of collages: %w", err)
	}
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
